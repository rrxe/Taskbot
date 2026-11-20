-- =============================================================
-- EASY GRAM — Coins + USDT wallet (SLYMintX-compatible economy)
-- Safe to re-run. Keeps the old GRAM balances/history untouched.
-- Exchange rate: 1 Coin = 0.0000025 USDT (2,000 Coins = 0.005 USDT)
-- Run after sql_easygram.sql and EasyGram_SLY_AdsMining_AllInOne.sql.
-- The script also makes V5 referral/task cooldown columns idempotently available.
-- =============================================================

begin;

create extension if not exists pgcrypto;

-- 1) New wallets and the SLY-style daily withdrawal counters.
alter table public.easygram_users
  add column if not exists coin_balance bigint not null default 0,
  add column if not exists usdt_balance numeric(20,8) not null default 0,
  add column if not exists withdrawals_today integer not null default 0,
  add column if not exists withdrawal_count_date date,
  add column if not exists withdrawal_ads_watched integer not null default 0,
  add column if not exists is_banned boolean not null default false,
  add column if not exists adsgram_native_task_verified_at timestamptz;

-- Keep the current task/referral rules intact even on installations that
-- applied the core schema and AdsMining patch but skipped optional V5 files.
alter table public.easygram_tasks
  add column if not exists cooldown_hours integer not null default 5;
alter table public.easygram_task_completions
  add column if not exists cycle_count integer not null default 0,
  add column if not exists cooldown_until timestamptz;
alter table public.easygram_referrals
  add column if not exists status text not null default 'paid',
  add column if not exists required_tasks integer not null default 0,
  add column if not exists qualified_at timestamptz;

insert into public.easygram_settings (key, value)
values ('referral_tasks_required', '3'::jsonb)
on conflict (key) do nothing;

create index if not exists easygram_referrals_referrer_status_idx
  on public.easygram_referrals (referrer_id, status, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'easygram_tasks_cooldown_hours_range'
       and conrelid = 'public.easygram_tasks'::regclass
  ) then
    alter table public.easygram_tasks
      add constraint easygram_tasks_cooldown_hours_range
      check (cooldown_hours between 1 and 168);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'easygram_referrals_status_check'
       and conrelid = 'public.easygram_referrals'::regclass
  ) then
    alter table public.easygram_referrals
      add constraint easygram_referrals_status_check
      check (status in ('pending','paid'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'easygram_users_coin_balance_nonnegative'
      and conrelid = 'public.easygram_users'::regclass
  ) then
    alter table public.easygram_users
      add constraint easygram_users_coin_balance_nonnegative check (coin_balance >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'easygram_users_usdt_balance_nonnegative'
      and conrelid = 'public.easygram_users'::regclass
  ) then
    alter table public.easygram_users
      add constraint easygram_users_usdt_balance_nonnegative check (usdt_balance >= 0);
  end if;
end $$;

-- 2) New integer task rewards. Existing configured GRAM task rewards are
-- carried across as Coins using 1 legacy reward unit = 1,000,000 Coins.
-- This does NOT convert users' existing GRAM balances.
alter table public.easygram_tasks
  add column if not exists reward_coins bigint;

update public.easygram_tasks
   set reward_coins = case
     when coalesce(reward_gram, 0) <= 0 then 0
     else greatest(1, round(reward_gram * 1000000)::bigint)
   end
 where reward_coins is null;

alter table public.easygram_tasks
  alter column reward_coins set default 1000,
  alter column reward_coins set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'easygram_tasks_reward_coins_nonnegative'
      and conrelid = 'public.easygram_tasks'::regclass
  ) then
    alter table public.easygram_tasks
      add constraint easygram_tasks_reward_coins_nonnegative check (reward_coins >= 0);
  end if;
end $$;

-- Referral rewards now settle into coin_balance. Existing pending reward
-- values are translated to the same new in-app unit.
alter table public.easygram_referrals
  add column if not exists reward_coins bigint;

update public.easygram_referrals
   set reward_coins = greatest(0, round(coalesce(reward_gram, 0) * 1000000)::bigint)
 where reward_coins is null;

alter table public.easygram_referrals
  alter column reward_coins set default 0,
  alter column reward_coins set not null;

-- 3) AdsGram can now authorize exchange ads too. This is a server-recorded
-- ad session, not a client-side reward claim.
alter table public.easygram_ad_sessions
  drop constraint if exists easygram_ad_sessions_placement_check;
alter table public.easygram_ad_sessions
  add constraint easygram_ad_sessions_placement_check
  check (placement in ('task','withdrawal','mining_start','mining_claim','exchange'));

create index if not exists easygram_ad_sessions_exchange_idx
  on public.easygram_ad_sessions (telegram_id, started_at desc)
  where placement = 'exchange';

-- 4) Settings. Coin rewards inherit the existing configured GRAM reward
-- magnitudes at the fixed denomination factor above. Admin can tune them.
insert into public.easygram_settings (key, value)
select 'referral_reward_coins', to_jsonb(greatest(0, round(coalesce((value #>> '{}')::numeric, 0) * 1000000)::bigint))
  from public.easygram_settings where key = 'referral_reward'
on conflict (key) do nothing;

insert into public.easygram_settings (key, value)
select 'mining_rate_per_hour_coins', to_jsonb(greatest(0, round(coalesce((value #>> '{}')::numeric, 0) * 1000000)::bigint))
  from public.easygram_settings where key = 'mining_rate_per_hour'
on conflict (key) do nothing;

insert into public.easygram_settings (key, value)
select 'adsgram_native_task_reward_coins', to_jsonb(greatest(0, round(coalesce((value #>> '{}')::numeric, 0) * 1000000)::bigint))
  from public.easygram_settings where key = 'adsgram_native_task_reward_gram'
on conflict (key) do nothing;

insert into public.easygram_settings (key, value) values
  ('coin_exchange_rate', '0.0000025'::jsonb),
  ('min_exchange_coins', '1000'::jsonb),
  ('min_withdrawal_usdt', '0.1'::jsonb),
  ('max_withdrawal_usdt', '0.2'::jsonb),
  ('withdrawal_ads_base', '10'::jsonb),
  ('withdrawal_ads_increment', '10'::jsonb)
on conflict (key) do nothing;

-- 5) Separate USDT withdrawal history. Legacy GRAM withdrawals remain intact.
create table if not exists public.easygram_usdt_withdrawals (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete restrict,
  amount_usdt numeric(20,8) not null check (amount_usdt > 0),
  method text not null check (method in ('binance','bnb')),
  target text not null,
  status text not null default 'pending' check (status in ('pending','completed','rejected')),
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists easygram_usdt_withdrawals_user_idx
  on public.easygram_usdt_withdrawals (telegram_id, created_at desc);
create index if not exists easygram_usdt_withdrawals_pending_idx
  on public.easygram_usdt_withdrawals (status, created_at asc);
alter table public.easygram_usdt_withdrawals enable row level security;

-- 5a) Mark mining-session denomination. Preserve completed historic rows;
-- convert only sessions still waiting to be claimed, exactly once.
alter table public.easygram_mining_sessions
  add column if not exists coin_rate boolean not null default false;
update public.easygram_mining_sessions
   set rate_per_hour = round(rate_per_hour * 1000000, 8),
       coin_rate = true
 where claimed_at is null and coin_rate = false;

-- 6) Confirm AdsGram sessions. Exchange ads are verified but do not increment
-- the withdrawal-ad counter. Withdrawal ads still increment only once.
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer);
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer,boolean);

create function public.easygram_confirm_ad_session(
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
  if p_placement not in ('task','withdrawal','mining_start','mining_claim','exchange') then
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

-- 7) Task completion pays Coins. Session consumption and wallet credit are
-- performed in one transaction, so a task/ad cannot be claimed twice.
drop function if exists public.easygram_complete_task(text,bigint,uuid,uuid);

create function public.easygram_complete_task(
  p_telegram_id text,
  p_task_id bigint,
  p_task_session_id uuid default null,
  p_ad_session_id uuid default null
) returns table(reward_coins bigint, coin_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.easygram_tasks%rowtype;
  v_count integer := 0;
  v_cycle_count integer := 0;
  v_cooldown_until timestamptz := null;
  v_consumed uuid;
  v_min_watch_seconds integer := 5;
begin
  select coalesce((setting_row.value #>> '{}')::integer, 5)
    into v_min_watch_seconds
    from public.easygram_settings as setting_row
   where setting_row.key = 'task_min_watch_seconds';
  v_min_watch_seconds := greatest(5, least(coalesce(v_min_watch_seconds, 5), 60));

  select task_row.* into v_task
    from public.easygram_tasks as task_row
   where task_row.id = p_task_id and task_row.is_active = true
   for update;
  if not found then raise exception 'Task is unavailable'; end if;
  if coalesce(v_task.reward_coins, 0) < 0 then raise exception 'Invalid task reward'; end if;

  perform 1 from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  select completion_row.completion_count, completion_row.cycle_count, completion_row.cooldown_until
    into v_count, v_cycle_count, v_cooldown_until
    from public.easygram_task_completions as completion_row
   where completion_row.telegram_id = p_telegram_id
     and completion_row.task_id = p_task_id
   for update;
  if not found then
    v_count := 0;
    v_cycle_count := 0;
    v_cooldown_until := null;
  end if;

  if v_task.kind = 'ad' then
    if v_task.max_completions > 0 and v_cooldown_until is not null and v_cooldown_until > now() then
      raise exception 'Ad task cooldown active. Try again after the cooldown ends.';
    end if;
    update public.easygram_ad_sessions as ad_session
       set used_at = now()
     where ad_session.id = p_ad_session_id
       and ad_session.telegram_id = p_telegram_id
       and ad_session.placement = 'task'
       and ad_session.confirmed_at is not null
       and ad_session.used_at is null
       and ad_session.started_at > now() - interval '10 minutes'
    returning ad_session.id into v_consumed;
    if v_consumed is null then raise exception 'A verified task ad is required'; end if;
  else
    if v_task.max_completions > 0 and v_count >= v_task.max_completions then
      raise exception 'Task completion limit reached';
    end if;
    update public.easygram_task_sessions as task_session
       set used_at = now()
     where task_session.id = p_task_session_id
       and task_session.telegram_id = p_telegram_id
       and task_session.task_id = p_task_id
       and task_session.used_at is null
       and task_session.expires_at > now()
       and task_session.opened_at <= now() - make_interval(secs => v_min_watch_seconds)
    returning task_session.id into v_consumed;
    if v_consumed is null then raise exception 'Open the task and wait at least 5 seconds before verifying'; end if;
  end if;

  insert into public.easygram_task_completions as completion_row
    (telegram_id, task_id, completion_count, last_completed_at, cycle_count, cooldown_until)
  values (
    p_telegram_id, p_task_id, 1, now(),
    case
      when v_task.kind = 'ad' and v_task.max_completions = 1 then 0
      when v_task.kind = 'ad' and v_task.max_completions > 1 then 1
      else 0
    end,
    case when v_task.kind = 'ad' and v_task.max_completions = 1
      then now() + make_interval(hours => v_task.cooldown_hours) else null end
  )
  on conflict (telegram_id, task_id) do update
    set completion_count = completion_row.completion_count + 1,
        last_completed_at = excluded.last_completed_at,
        cycle_count = case
          when v_task.kind = 'ad' and v_task.max_completions = 0 then 0
          when v_task.kind = 'ad' and v_task.max_completions > 0 then
            case when completion_row.cycle_count + 1 >= v_task.max_completions then 0
                 else completion_row.cycle_count + 1 end
          else completion_row.cycle_count end,
        cooldown_until = case
          when v_task.kind = 'ad' and v_task.max_completions = 0 then null
          when v_task.kind = 'ad' and v_task.max_completions > 0
            and completion_row.cycle_count + 1 >= v_task.max_completions
            then now() + make_interval(hours => v_task.cooldown_hours)
          when v_task.kind = 'ad' and v_task.max_completions > 0 then null
          else completion_row.cooldown_until end;

  update public.easygram_users as user_row
     set coin_balance = user_row.coin_balance + coalesce(v_task.reward_coins, 0)
   where user_row.telegram_id = p_telegram_id
  returning user_row.coin_balance into coin_balance;

  reward_coins := coalesce(v_task.reward_coins, 0);
  return next;
end;
$$;

-- 8) Referral registration and qualification now pay Coins.
create or replace function public.easygram_award_referral(
  p_referrer_id text,
  p_referred_id text,
  p_reward numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id bigint;
  v_required_tasks integer := 3;
begin
  if p_referrer_id is null or p_referred_id is null or p_referrer_id = p_referred_id then
    return false;
  end if;
  if not exists (select 1 from public.easygram_users where telegram_id = p_referrer_id) then
    return false;
  end if;
  select greatest(1, least(coalesce((setting_row.value #>> '{}')::integer, 3), 50))
    into v_required_tasks
    from public.easygram_settings as setting_row
   where setting_row.key = 'referral_tasks_required';
  v_required_tasks := greatest(1, least(coalesce(v_required_tasks, 3), 50));

  insert into public.easygram_referrals
    (referrer_id, referred_id, reward_gram, reward_coins, status, required_tasks)
  values
    (p_referrer_id, p_referred_id, 0, greatest(0, floor(coalesce(p_reward, 0))::bigint), 'pending', v_required_tasks)
  on conflict (referred_id) do nothing
  returning id into inserted_id;

  return inserted_id is not null;
end;
$$;

create or replace function public.easygram_qualify_referral(
  p_referred_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.easygram_referrals%rowtype;
  v_completed_tasks integer;
begin
  select * into v_referral
    from public.easygram_referrals
   where referred_id = p_referred_id
   for update;
  if not found or v_referral.status <> 'pending' then return false; end if;

  select count(*)::integer into v_completed_tasks
    from public.easygram_task_completions
   where telegram_id = p_referred_id and completion_count > 0;
  if v_completed_tasks < greatest(v_referral.required_tasks, 1) then return false; end if;

  update public.easygram_referrals
     set status = 'paid', qualified_at = now()
   where id = v_referral.id and status = 'pending';
  if not found then return false; end if;

  update public.easygram_users
     set coin_balance = coin_balance + greatest(coalesce(v_referral.reward_coins, 0), 0)
   where telegram_id = v_referral.referrer_id;
  return true;
end;
$$;

-- 9) Mining starts use Coin-scale rates. The older GRAM function capped the
-- hourly rate at 100, which would truncate a valid 20,000 Coins/hour reward.
create or replace function public.easygram_start_mining(
  p_telegram_id text,
  p_rate_per_hour numeric,
  p_duration_hours numeric
) returns setof public.easygram_mining_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.easygram_mining_sessions%rowtype;
  v_rate numeric(20,8);
  v_duration numeric(8,2);
begin
  perform 1 from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  v_rate := greatest(0, least(coalesce(p_rate_per_hour, 20000), 1000000000));
  v_duration := greatest(1, least(coalesce(p_duration_hours, 6), 24));

  select mining_row.* into v_session
    from public.easygram_mining_sessions as mining_row
   where mining_row.telegram_id = p_telegram_id
     and mining_row.claimed_at is null
   order by mining_row.started_at desc
   limit 1 for update;
  if found then return next v_session; return; end if;

  insert into public.easygram_mining_sessions
    (telegram_id, started_at, ends_at, rate_per_hour, duration_hours, coin_rate)
  values
    (p_telegram_id, now(), now() + make_interval(secs => (v_duration * 3600)::integer), v_rate, v_duration, true)
  returning * into v_session;
  return next v_session;
end;
$$;

-- 10) Mining claims now credit the new Coin wallet. The session table and
-- ad-protected mining-start/claim functions remain compatible with the app.
drop function if exists public.easygram_claim_mining(text);
create function public.easygram_claim_mining(
  p_telegram_id text
) returns table(reward_gram numeric, balance_gram numeric, started_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.easygram_mining_sessions%rowtype;
  v_reward numeric(20,8);
  v_coin_balance bigint;
  v_claimed_id uuid;
begin
  perform 1 from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  select mining_row.* into v_session
    from public.easygram_mining_sessions as mining_row
   where mining_row.telegram_id = p_telegram_id and mining_row.claimed_at is null
   order by mining_row.started_at desc limit 1 for update;
  if not found then raise exception 'No active mining session'; end if;
  if now() < v_session.ends_at then raise exception 'Mining is not finished yet'; end if;

  v_reward := round(v_session.rate_per_hour * v_session.duration_hours, 0);
  update public.easygram_mining_sessions as mining_row
     set claimed_at = now(), reward_gram = v_reward
   where mining_row.id = v_session.id and mining_row.claimed_at is null
  returning mining_row.id into v_claimed_id;
  if v_claimed_id is null then raise exception 'Mining reward was already claimed'; end if;

  update public.easygram_users as user_row
     set coin_balance = user_row.coin_balance + greatest(0, v_reward::bigint)
   where user_row.telegram_id = p_telegram_id
  returning user_row.coin_balance into v_coin_balance;

  reward_gram := v_reward;
  balance_gram := v_coin_balance;
  started_at := v_session.started_at;
  ends_at := v_session.ends_at;
  return next;
end;
$$;

-- 11) AdsGram Native Task callback reward is also credited as Coins.
drop function if exists public.easygram_claim_adsgram_native_task(text,numeric);
create function public.easygram_claim_adsgram_native_task(
  p_telegram_id text,
  p_reward numeric
) returns table(coin_balance bigint, reward_coins bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_telegram_id is null or p_reward is null or p_reward <= 0 or p_reward > 100000000000 then
    return;
  end if;
  return query
    update public.easygram_users as user_row
       set coin_balance = user_row.coin_balance + floor(p_reward)::bigint,
           adsgram_native_task_verified_at = null
     where user_row.telegram_id = p_telegram_id
       and user_row.adsgram_native_task_verified_at is not null
    returning user_row.coin_balance, floor(p_reward)::bigint;
end;
$$;

-- 12) Exchange Coins -> USDT. A confirmed, fresh, unused AdsGram exchange
-- session is mandatory and is consumed atomically with the balance changes.
drop function if exists public.easygram_exchange_coins_for_usdt(text,bigint,uuid);
create function public.easygram_exchange_coins_for_usdt(
  p_telegram_id text,
  p_amount_coins bigint,
  p_ad_session_id uuid
) returns table(coin_balance bigint, usdt_balance numeric, usdt_gained numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_ad public.easygram_ad_sessions%rowtype;
  v_usdt numeric(20,8);
begin
  if p_amount_coins is null or p_amount_coins < 1000 then
    raise exception 'Minimum exchange is 1,000 Coins';
  end if;
  if p_amount_coins > 9000000000000000000 then raise exception 'Invalid Coin amount'; end if;

  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id and coalesce(is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  select * into v_ad from public.easygram_ad_sessions
   where id = p_ad_session_id and telegram_id = p_telegram_id
     and placement = 'exchange' and confirmed_at is not null
     and used_at is null and started_at > now() - interval '10 minutes'
   for update;
  if not found then raise exception 'Watch a verified AdsGram exchange ad before converting Coins'; end if;

  if v_user.coin_balance < p_amount_coins then raise exception 'Insufficient Coin balance'; end if;
  v_usdt := round(p_amount_coins::numeric * 0.0000025, 8);
  if v_usdt <= 0 then raise exception 'Exchange amount is too small'; end if;

  update public.easygram_ad_sessions set used_at = now()
   where id = p_ad_session_id and used_at is null;
  if not found then raise exception 'This exchange ad was already used'; end if;

  update public.easygram_users as user_row
     set coin_balance = user_row.coin_balance - p_amount_coins,
         usdt_balance = user_row.usdt_balance + v_usdt
   where user_row.telegram_id = p_telegram_id
  returning user_row.coin_balance, user_row.usdt_balance
       into coin_balance, usdt_balance;
  usdt_gained := v_usdt;
  return next;
end;
$$;

-- 13) SLY-style USDT withdrawals: 0.1–0.2 USDT each; first request needs
-- 10 ads, then +10 ads for every additional submitted request that day.
drop function if exists public.easygram_submit_usdt_withdrawal(text,numeric,text,text);
create function public.easygram_submit_usdt_withdrawal(
  p_telegram_id text,
  p_amount_usdt numeric,
  p_method text,
  p_target text
) returns setof public.easygram_usdt_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.easygram_users%rowtype;
  v_request public.easygram_usdt_withdrawals%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_count integer;
  v_required integer;
  v_min numeric := 0.1;
  v_max numeric := 0.2;
begin
  if p_amount_usdt is null or p_amount_usdt < v_min then raise exception 'Minimum withdrawal is 0.1 USDT'; end if;
  if p_amount_usdt > v_max then raise exception 'Maximum withdrawal is 0.2 USDT per request'; end if;
  if p_method not in ('binance','bnb') then raise exception 'Invalid withdrawal method'; end if;
  if length(trim(coalesce(p_target, ''))) < 6 or length(trim(coalesce(p_target, ''))) > 160 then
    raise exception 'Enter a valid withdrawal destination';
  end if;

  select * into v_user from public.easygram_users
   where telegram_id = p_telegram_id and coalesce(is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  if exists (select 1 from public.easygram_usdt_withdrawals
              where telegram_id = p_telegram_id and status = 'pending') then
    raise exception 'You already have a pending USDT withdrawal';
  end if;

  v_count := case when v_user.withdrawal_count_date = v_today
                  then greatest(0, coalesce(v_user.withdrawals_today, 0)) else 0 end;
  v_required := 10 + (v_count * 10);
  if coalesce(v_user.withdrawal_ads_watched, 0) < v_required then
    raise exception 'Watch % withdrawal ads before requesting a payout', v_required;
  end if;
  if v_user.usdt_balance < p_amount_usdt then raise exception 'Insufficient USDT balance'; end if;

  update public.easygram_users
     set usdt_balance = usdt_balance - p_amount_usdt,
         withdrawal_ads_watched = 0,
         withdrawals_today = v_count + 1,
         withdrawal_count_date = v_today
   where telegram_id = p_telegram_id;

  insert into public.easygram_usdt_withdrawals (telegram_id, amount_usdt, method, target, status)
  values (p_telegram_id, round(p_amount_usdt, 8), p_method, trim(p_target), 'pending')
  returning * into v_request;
  return next v_request;
end;
$$;

create or replace function public.easygram_review_usdt_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_admin_id text,
  p_admin_note text default null
) returns setof public.easygram_usdt_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.easygram_usdt_withdrawals%rowtype;
begin
  select * into v_request from public.easygram_usdt_withdrawals
   where id = p_withdrawal_id for update;
  if not found then raise exception 'USDT withdrawal not found'; end if;
  if v_request.status <> 'pending' then raise exception 'This withdrawal has already been reviewed'; end if;
  if p_action not in ('approve','reject') then raise exception 'Invalid review action'; end if;

  if p_action = 'reject' then
    update public.easygram_users
       set usdt_balance = usdt_balance + v_request.amount_usdt
     where telegram_id = v_request.telegram_id;
  end if;

  update public.easygram_usdt_withdrawals
     set status = case when p_action = 'approve' then 'completed' else 'rejected' end,
         admin_note = p_admin_note,
         reviewed_by = p_admin_id,
         reviewed_at = now(),
         updated_at = now()
   where id = p_withdrawal_id
  returning * into v_request;

  insert into public.easygram_audit_logs (actor_telegram_id, action, details)
  values (p_admin_id, 'review_usdt_withdrawal',
          jsonb_build_object('withdrawal_id', p_withdrawal_id, 'decision', p_action));
  return next v_request;
end;
$$;

-- 14) Lock down server-side reward and payout functions.
revoke all on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) from public, anon, authenticated;
revoke all on function public.easygram_complete_task(text,bigint,uuid,uuid) from public, anon, authenticated;
revoke all on function public.easygram_award_referral(text,text,numeric) from public, anon, authenticated;
revoke all on function public.easygram_qualify_referral(text) from public, anon, authenticated;
revoke all on function public.easygram_start_mining(text,numeric,numeric) from public, anon, authenticated;
revoke all on function public.easygram_claim_mining(text) from public, anon, authenticated;
revoke all on function public.easygram_claim_adsgram_native_task(text,numeric) from public, anon, authenticated;
revoke all on function public.easygram_exchange_coins_for_usdt(text,bigint,uuid) from public, anon, authenticated;
revoke all on function public.easygram_submit_usdt_withdrawal(text,numeric,text,text) from public, anon, authenticated;
revoke all on function public.easygram_review_usdt_withdrawal(uuid,text,text,text) from public, anon, authenticated;

grant execute on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) to service_role;
grant execute on function public.easygram_complete_task(text,bigint,uuid,uuid) to service_role;
grant execute on function public.easygram_award_referral(text,text,numeric) to service_role;
grant execute on function public.easygram_qualify_referral(text) to service_role;
grant execute on function public.easygram_start_mining(text,numeric,numeric) to service_role;
grant execute on function public.easygram_claim_mining(text) to service_role;
grant execute on function public.easygram_claim_adsgram_native_task(text,numeric) to service_role;
grant execute on function public.easygram_exchange_coins_for_usdt(text,bigint,uuid) to service_role;
grant execute on function public.easygram_submit_usdt_withdrawal(text,numeric,text,text) to service_role;
grant execute on function public.easygram_review_usdt_withdrawal(uuid,text,text,text) to service_role;

notify pgrst, 'reload schema';

-- Verification: should show both new wallets, the exchange placement and the
-- new withdrawal table. Old GRAM balances are intentionally still present.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'easygram_users'
   and column_name in ('balance_gram','coin_balance','usdt_balance','withdrawal_ads_watched','withdrawals_today')
 order by column_name;

select placement, count(*)
  from public.easygram_ad_sessions group by placement order by placement;

select count(*) as pending_usdt_withdrawals
  from public.easygram_usdt_withdrawals where status = 'pending';

-- OPTIONAL, ONLY if you explicitly want to migrate old GRAM balances too:
-- This converts 1 previous stored GRAM unit into 1,000,000 new Coins.
-- Review the monetary implications before uncommenting; it is NOT run by default.
-- update public.easygram_users
--    set coin_balance = coin_balance + floor(balance_gram * 1000000)::bigint,
--        balance_gram = 0
--  where balance_gram > 0;

commit;
