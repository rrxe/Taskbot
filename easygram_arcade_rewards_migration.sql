-- =============================================================
-- EASY GRAM — Arcade, Daily Check-in & Gift Codes
-- Run AFTER sql_easygram.sql and easygram_coins_usdt_migration.sql.
-- All tables are Easy Gram-specific; no SLY tables are touched.
-- Safe to re-run.
-- =============================================================

begin;
create extension if not exists pgcrypto;

alter table public.easygram_users
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_daily_claim date;

insert into public.easygram_settings(key, value) values
  ('daily_checkin_rewards', '[200,300,400,500,650,800,1200]'::jsonb),
  ('game_daily_attempts', '3'::jsonb),
  ('game_min_duration_seconds', '8'::jsonb),
  ('game_reward_orbit', '600'::jsonb),
  ('game_reward_memory', '800'::jsonb),
  ('game_reward_reactor', '500'::jsonb)
on conflict (key) do nothing;

create table if not exists public.easygram_daily_checkins (
  id bigserial primary key,
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  checkin_date date not null,
  streak integer not null default 1,
  reward_coins bigint not null check (reward_coins >= 0),
  created_at timestamptz not null default now(),
  unique (telegram_id, checkin_date)
);
create index if not exists easygram_daily_checkins_user_date_idx
  on public.easygram_daily_checkins(telegram_id, checkin_date desc);

create table if not exists public.easygram_gift_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  reward_coins bigint not null check (reward_coins >= 0),
  max_uses integer not null default 0 check (max_uses >= 0), -- 0 = unlimited
  current_uses integer not null default 0 check (current_uses >= 0),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists easygram_gift_codes_active_idx
  on public.easygram_gift_codes(is_active, created_at desc);

create table if not exists public.easygram_gift_code_redemptions (
  id bigserial primary key,
  code_id uuid not null references public.easygram_gift_codes(id) on delete cascade,
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  reward_coins bigint not null check (reward_coins >= 0),
  redeemed_at timestamptz not null default now(),
  unique(code_id, telegram_id)
);
create index if not exists easygram_gift_redemptions_user_idx
  on public.easygram_gift_code_redemptions(telegram_id, redeemed_at desc);

create table if not exists public.easygram_game_runs (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  game_id text not null check (game_id in ('orbit','memory','reactor')),
  score integer not null default 0 check (score >= 0 and score <= 10000),
  reward_coins bigint not null default 0 check (reward_coins >= 0),
  status text not null default 'started' check (status in ('started','completed','expired')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists easygram_game_runs_user_day_idx
  on public.easygram_game_runs(telegram_id, started_at desc);
create index if not exists easygram_game_runs_leaderboard_idx
  on public.easygram_game_runs(finished_at desc, score desc)
  where status = 'completed';

alter table public.easygram_daily_checkins enable row level security;
alter table public.easygram_gift_codes enable row level security;
alter table public.easygram_gift_code_redemptions enable row level security;
alter table public.easygram_game_runs enable row level security;

revoke all on public.easygram_daily_checkins from anon, authenticated;
revoke all on public.easygram_gift_codes from anon, authenticated;
revoke all on public.easygram_gift_code_redemptions from anon, authenticated;
revoke all on public.easygram_game_runs from anon, authenticated;

-- Daily check-in: database date is explicitly UTC; user row lock makes
-- same-day double taps and concurrent requests safe.
create or replace function public.easygram_claim_daily_checkin(p_telegram_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_streak integer;
  v_day integer;
  v_reward bigint;
  v_rewards jsonb;
begin
  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id for update;
  if not found then raise exception 'Easy Gram account not found'; end if;
  if coalesce(v_user.is_banned, false) then raise exception 'This account is suspended'; end if;
  if v_user.last_daily_claim = v_today then raise exception 'Daily reward already claimed'; end if;

  if v_user.last_daily_claim = v_today - 1 then
    v_streak := coalesce(v_user.daily_streak, 0) + 1;
  else
    v_streak := 1;
  end if;
  v_day := ((v_streak - 1) % 7) + 1;
  select value into v_rewards from public.easygram_settings where key = 'daily_checkin_rewards';
  v_reward := greatest(0, coalesce((v_rewards ->> (v_day - 1))::bigint, 200));

  insert into public.easygram_daily_checkins(telegram_id, checkin_date, streak, reward_coins)
  values (p_telegram_id, v_today, v_streak, v_reward);
  update public.easygram_users
     set coin_balance = coin_balance + v_reward,
         daily_streak = v_streak,
         last_daily_claim = v_today
   where telegram_id = p_telegram_id
   returning * into v_user;

  return jsonb_build_object(
    'success', true,
    'reward', v_reward,
    'streak', v_streak,
    'day', v_day,
    'balance', v_user.coin_balance,
    'claimDate', v_today
  );
end;
$$;

-- Gift code redemption is atomic and unique per user/code. Usage limits are
-- enforced under a row lock so concurrent redemptions cannot exceed max_uses.
create or replace function public.easygram_redeem_gift_code(p_telegram_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_code public.easygram_gift_codes%rowtype;
  v_new_balance bigint;
begin
  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id for update;
  if not found then raise exception 'Easy Gram account not found'; end if;
  if coalesce(v_user.is_banned, false) then raise exception 'This account is suspended'; end if;

  select * into v_code from public.easygram_gift_codes
   where code = upper(trim(p_code)) for update;
  if not found or not v_code.is_active then raise exception 'Invalid or inactive gift code'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'This gift code has expired'; end if;
  if v_code.max_uses > 0 and v_code.current_uses >= v_code.max_uses then raise exception 'This gift code has reached its usage limit'; end if;
  if exists (
    select 1 from public.easygram_gift_code_redemptions
     where code_id = v_code.id and telegram_id = p_telegram_id
  ) then raise exception 'You have already used this gift code'; end if;

  insert into public.easygram_gift_code_redemptions(code_id, telegram_id, reward_coins)
  values (v_code.id, p_telegram_id, v_code.reward_coins);
  update public.easygram_gift_codes
     set current_uses = current_uses + 1, updated_at = now()
   where id = v_code.id;
  update public.easygram_users
     set coin_balance = coin_balance + v_code.reward_coins
   where telegram_id = p_telegram_id
   returning coin_balance into v_new_balance;

  return jsonb_build_object(
    'success', true,
    'reward', v_code.reward_coins,
    'balance', v_new_balance,
    'code', v_code.code
  );
end;
$$;

-- Game attempts are reserved at start, so force-closing a game cannot be used
-- to repeatedly obtain free attempts. A completed run can be rewarded only once.
create or replace function public.easygram_start_game(
  p_telegram_id text,
  p_game_id text,
  p_daily_limit integer,
  p_reward_coins bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_used integer;
  v_run public.easygram_game_runs%rowtype;
begin
  if p_game_id not in ('orbit','memory','reactor') then raise exception 'Unknown game'; end if;
  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id for update;
  if not found then raise exception 'Easy Gram account not found'; end if;
  if coalesce(v_user.is_banned, false) then raise exception 'This account is suspended'; end if;

  select count(*) into v_used from public.easygram_game_runs
   where telegram_id = p_telegram_id
     and (started_at at time zone 'UTC')::date = v_today;
  if v_used >= greatest(1, least(20, coalesce(p_daily_limit, 3))) then
    raise exception 'Daily game attempts used';
  end if;

  insert into public.easygram_game_runs(telegram_id, game_id, reward_coins)
  values (p_telegram_id, p_game_id, greatest(0, least(1000000000, coalesce(p_reward_coins, 0))))
  returning * into v_run;
  return jsonb_build_object(
    'success', true,
    'runId', v_run.id,
    'gameId', v_run.game_id,
    'startedAt', v_run.started_at,
    'attemptsUsed', v_used + 1,
    'attemptsRemaining', greatest(0, p_daily_limit - v_used - 1)
  );
end;
$$;

create or replace function public.easygram_finish_game(
  p_telegram_id text,
  p_run_id uuid,
  p_score integer,
  p_min_duration_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.easygram_game_runs%rowtype;
  v_balance bigint;
  v_now timestamptz := now();
begin
  select * into v_run from public.easygram_game_runs
   where id = p_run_id and telegram_id = p_telegram_id for update;
  if not found then raise exception 'Game session not found'; end if;
  if v_run.status <> 'started' or v_run.finished_at is not null then raise exception 'This game session was already used'; end if;
  if v_run.started_at > v_now - make_interval(secs => greatest(5, least(60, coalesce(p_min_duration_seconds, 8)))) then
    raise exception 'Play the game a little longer before claiming the reward';
  end if;
  if p_score is null or p_score < 0 or p_score > 10000 then raise exception 'Invalid game score'; end if;
  if v_run.game_id = 'orbit' and (p_score < 8 or p_score > 40) then raise exception 'Target score not reached'; end if;
  if v_run.game_id = 'memory' and p_score <> 4 then raise exception 'All matching pairs must be completed'; end if;
  if v_run.game_id = 'reactor' and (p_score < 18 or p_score > 100) then raise exception 'Reactor score not reached'; end if;

  update public.easygram_game_runs
     set score = p_score, status = 'completed', finished_at = v_now
   where id = v_run.id;
  update public.easygram_users
     set coin_balance = coin_balance + v_run.reward_coins
   where telegram_id = p_telegram_id
   returning coin_balance into v_balance;

  return jsonb_build_object(
    'success', true,
    'gameId', v_run.game_id,
    'score', p_score,
    'reward', v_run.reward_coins,
    'balance', v_balance
  );
end;
$$;

-- Aggregate the full seven-day leaderboard in PostgreSQL rather than
-- truncating individual game rows in the API when traffic grows.
create or replace function public.easygram_weekly_game_leaderboard()
returns table (
  telegram_id text,
  username text,
  first_name text,
  score bigint,
  coins bigint,
  games bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    runs.telegram_id,
    users.username,
    users.first_name,
    sum(runs.score)::bigint as score,
    sum(runs.reward_coins)::bigint as coins,
    count(*)::bigint as games
  from public.easygram_game_runs as runs
  join public.easygram_users as users on users.telegram_id = runs.telegram_id
  where runs.status = 'completed'
    and runs.finished_at >= now() - interval '7 days'
  group by runs.telegram_id, users.username, users.first_name
  order by sum(runs.score) desc, sum(runs.reward_coins) desc
  limit 10;
$$;

revoke all on function public.easygram_claim_daily_checkin(text) from public, anon, authenticated;
revoke all on function public.easygram_redeem_gift_code(text,text) from public, anon, authenticated;
revoke all on function public.easygram_start_game(text,text,integer,bigint) from public, anon, authenticated;
revoke all on function public.easygram_finish_game(text,uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.easygram_weekly_game_leaderboard() from public, anon, authenticated;
grant execute on function public.easygram_claim_daily_checkin(text) to service_role;
grant execute on function public.easygram_redeem_gift_code(text,text) to service_role;
grant execute on function public.easygram_start_game(text,text,integer,bigint) to service_role;
grant execute on function public.easygram_finish_game(text,uuid,integer,integer) to service_role;
grant execute on function public.easygram_weekly_game_leaderboard() to service_role;

notify pgrst, 'reload schema';
commit;
