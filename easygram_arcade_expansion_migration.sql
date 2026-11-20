-- =============================================================
-- EASY GRAM — Arcade Expansion
-- Adds two interactive games and securely verified bonus attempts.
-- Run AFTER easygram_arcade_rewards_migration.sql.
-- Safe to re-run.
-- =============================================================

begin;

-- Keep the reward AdsGram flow in the existing Easy Gram ad-session table.
alter table public.easygram_ad_sessions
  drop constraint if exists easygram_ad_sessions_placement_check;
alter table public.easygram_ad_sessions
  add constraint easygram_ad_sessions_placement_check
  check (placement in ('task','withdrawal','mining_start','mining_claim','exchange','game_attempt'));
create index if not exists easygram_ad_sessions_game_attempt_idx
  on public.easygram_ad_sessions (telegram_id, started_at desc)
  where placement = 'game_attempt';


-- Extend the existing server-side ad confirmation RPC to recognize game attempts.
-- The client still cannot create a reward by itself: AdsGram timing and session
-- ownership are verified here before the bonus-attempt RPC can consume the row.
create or replace function public.easygram_confirm_ad_session(
  p_session_id uuid,
  p_telegram_id text,
  p_placement text,
  p_away_ms integer,
  p_pulse_away boolean
) returns table(session_id uuid, placement text, withdrawal_ads_watched integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.easygram_ad_sessions%rowtype;
  v_count integer := null;
  v_elapsed_ms bigint;
begin
  if p_placement not in ('task','withdrawal','mining_start','mining_claim','exchange','game_attempt') then
    raise exception 'Invalid ad placement';
  end if;
  if coalesce(p_away_ms, 0) < 4500 then
    raise exception 'Watch the ad for at least 5 seconds';
  end if;

  select ad_row.* into v_session
    from public.easygram_ad_sessions as ad_row
   where ad_row.id = p_session_id
     and ad_row.telegram_id = p_telegram_id
   for update;

  if not found or v_session.placement <> p_placement then
    raise exception 'This ad session is invalid';
  end if;
  if v_session.used_at is not null then
    raise exception 'This ad session has already been used';
  end if;

  if v_session.confirmed_at is not null then
    if v_session.placement = 'withdrawal' then
      select user_row.withdrawal_ads_watched into v_count
        from public.easygram_users as user_row
       where user_row.telegram_id = p_telegram_id;
    end if;
    return query select v_session.id, v_session.placement, v_count;
    return;
  end if;

  v_elapsed_ms := floor(extract(epoch from (clock_timestamp() - v_session.started_at)) * 1000)::bigint;
  if v_elapsed_ms < 4500 or v_elapsed_ms > 600000 then
    raise exception 'Ad session expired or was confirmed too early';
  end if;

  update public.easygram_ad_sessions as ad_row
     set confirmed_at = now(),
         pulse_away = coalesce(p_pulse_away, false),
         away_ms = greatest(0, p_away_ms)
   where ad_row.id = p_session_id
     and ad_row.telegram_id = p_telegram_id;

  if p_placement = 'withdrawal' then
    update public.easygram_users as user_row
       set withdrawal_ads_watched = user_row.withdrawal_ads_watched + 1
     where user_row.telegram_id = p_telegram_id
    returning user_row.withdrawal_ads_watched into v_count;
    if v_count is null then raise exception 'User not found'; end if;
  end if;

  return query select p_session_id, p_placement, v_count;
end;
$$;
revoke all on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) to service_role;

-- Two additional mini-games, plus a configurable daily cap on ad-earned runs.
alter table public.easygram_game_runs
  drop constraint if exists easygram_game_runs_game_id_check;
alter table public.easygram_game_runs
  add constraint easygram_game_runs_game_id_check
  check (game_id in ('orbit','memory','reactor','pulse','math'));

insert into public.easygram_settings(key, value) values
  ('game_reward_pulse', '700'::jsonb),
  ('game_reward_math', '900'::jsonb),
  ('game_max_bonus_attempts', '3'::jsonb)
on conflict (key) do nothing;

create table if not exists public.easygram_game_bonus_attempts (
  id bigserial primary key,
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  ad_session_id uuid not null unique references public.easygram_ad_sessions(id) on delete cascade,
  attempt_date date not null default ((now() at time zone 'UTC')::date),
  created_at timestamptz not null default now()
);
create index if not exists easygram_game_bonus_attempts_user_day_idx
  on public.easygram_game_bonus_attempts(telegram_id, attempt_date desc);

alter table public.easygram_game_bonus_attempts enable row level security;
revoke all on public.easygram_game_bonus_attempts from anon, authenticated;

-- A confirmed AdsGram session can grant exactly one extra attempt, up to the
-- configured daily limit. The same ad session cannot also pay a task reward.
create or replace function public.easygram_grant_game_bonus_attempt(
  p_telegram_id text,
  p_ad_session_id uuid,
  p_daily_limit integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_ad public.easygram_ad_sessions%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_used integer;
  v_limit integer := greatest(0, least(10, coalesce(p_daily_limit, 3)));
begin
  select * into v_user
    from public.easygram_users
   where telegram_id = p_telegram_id
   for update;
  if not found then raise exception 'Easy Gram account not found'; end if;
  if coalesce(v_user.is_banned, false) then raise exception 'This account is suspended'; end if;
  if v_limit <= 0 then raise exception 'Extra game attempts are disabled'; end if;

  select * into v_ad
    from public.easygram_ad_sessions
   where id = p_ad_session_id
     and telegram_id = p_telegram_id
     and placement = 'game_attempt'
     and confirmed_at is not null
     and used_at is null
     and started_at >= now() - interval '10 minutes'
   for update;
  if not found then raise exception 'A valid, verified game reward ad is required'; end if;

  select count(*)::integer into v_used
    from public.easygram_game_bonus_attempts
   where telegram_id = p_telegram_id
     and attempt_date = v_today;
  if v_used >= v_limit then raise exception 'Daily bonus game attempt limit reached'; end if;

  update public.easygram_ad_sessions
     set used_at = now()
   where id = v_ad.id and used_at is null;
  if not found then raise exception 'This ad session has already been used'; end if;

  insert into public.easygram_game_bonus_attempts(telegram_id, ad_session_id, attempt_date)
  values (p_telegram_id, v_ad.id, v_today);

  return jsonb_build_object(
    'success', true,
    'bonusAttempts', v_used + 1,
    'bonusLimit', v_limit,
    'attemptDate', v_today
  );
end;
$$;

-- Allow the expanded game list. The daily limit passed by the API includes
-- the free base attempts plus bonus attempts already earned from ads.
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
  v_allowed integer := greatest(1, least(30, coalesce(p_daily_limit, 3)));
  v_run public.easygram_game_runs%rowtype;
begin
  if p_game_id not in ('orbit','memory','reactor','pulse','math') then
    raise exception 'Unknown game';
  end if;
  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id for update;
  if not found then raise exception 'Easy Gram account not found'; end if;
  if coalesce(v_user.is_banned, false) then raise exception 'This account is suspended'; end if;

  select count(*) into v_used from public.easygram_game_runs
   where telegram_id = p_telegram_id
     and (started_at at time zone 'UTC')::date = v_today;
  if v_used >= v_allowed then raise exception 'Daily game attempts used'; end if;

  insert into public.easygram_game_runs(telegram_id, game_id, reward_coins)
  values (p_telegram_id, p_game_id, greatest(0, least(1000000000, coalesce(p_reward_coins, 0))))
  returning * into v_run;

  return jsonb_build_object(
    'success', true,
    'runId', v_run.id,
    'gameId', v_run.game_id,
    'startedAt', v_run.started_at,
    'attemptsUsed', v_used + 1,
    'attemptsRemaining', greatest(0, v_allowed - v_used - 1)
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
  if v_run.status <> 'started' or v_run.finished_at is not null then
    raise exception 'This game session was already used';
  end if;
  if v_run.started_at > v_now - make_interval(secs => greatest(5, least(60, coalesce(p_min_duration_seconds, 8)))) then
    raise exception 'Play the game a little longer before claiming the reward';
  end if;
  if p_score is null or p_score < 0 or p_score > 10000 then raise exception 'Invalid game score'; end if;

  if v_run.game_id = 'orbit' and (p_score < 8 or p_score > 40) then
    raise exception 'Target score not reached';
  elsif v_run.game_id = 'memory' and p_score <> 4 then
    raise exception 'All matching pairs must be completed';
  elsif v_run.game_id = 'reactor' and (p_score < 18 or p_score > 100) then
    raise exception 'Reactor score not reached';
  elsif v_run.game_id = 'pulse' and p_score <> 5 then
    raise exception 'Complete all five reaction rounds';
  elsif v_run.game_id = 'math' and p_score <> 6 then
    raise exception 'Answer all six math questions';
  end if;

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

revoke all on function public.easygram_grant_game_bonus_attempt(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.easygram_start_game(text,text,integer,bigint) from public, anon, authenticated;
revoke all on function public.easygram_finish_game(text,uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.easygram_grant_game_bonus_attempt(text,uuid,integer) to service_role;
grant execute on function public.easygram_start_game(text,text,integer,bigint) to service_role;
grant execute on function public.easygram_finish_game(text,uuid,integer,integer) to service_role;

notify pgrst, 'reload schema';
commit;
