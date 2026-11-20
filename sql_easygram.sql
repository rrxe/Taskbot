-- =============================================================
-- EASY GRAM — complete Supabase schema
-- Run this file once in Supabase SQL Editor using the project owner.
-- This schema is separate from SLY and uses easygram_* table names.
-- =============================================================

create extension if not exists pgcrypto;

create table if not exists public.easygram_users (
  telegram_id text primary key,
  username text,
  first_name text not null default 'Gram User',
  balance_gram numeric(20, 8) not null default 0 check (balance_gram >= 0),
  withdrawal_ads_watched integer not null default 0 check (withdrawal_ads_watched >= 0),
  adsgram_native_task_verified_at timestamptz,
  referred_by text,
  language text not null default 'en' check (language in ('ar','en')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists easygram_users_created_idx on public.easygram_users (created_at desc);
create index if not exists easygram_users_username_idx on public.easygram_users (lower(username));

create table if not exists public.easygram_admins (
  telegram_id text primary key,
  username text,
  first_name text,
  role text not null default 'moderator' check (role in ('owner','moderator')),
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.easygram_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.easygram_settings (key, value) values
  ('app_name', '"Easy Gram"'::jsonb),
  ('welcome_text', '"Complete simple tasks and collect Gram rewards."'::jsonb),
  ('min_withdrawal', '1'::jsonb),
  ('withdrawal_ads_required', '5'::jsonb),
  ('referral_reward', '0.05'::jsonb),
  ('task_min_watch_seconds', '5'::jsonb),
  ('ad_cooldown_seconds', '15'::jsonb),
  ('adsgram_auto_block', '"int-58010"'::jsonb),
  ('adsgram_reward_block', '"int-58009"'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('registration_enabled', 'true'::jsonb),
  ('support_username', '""'::jsonb),
  ('terms_url', '""'::jsonb),
  ('gram_network_label', '"Gram wallet"'::jsonb),
  ('gram_withdrawals_enabled', 'true'::jsonb),
  ('gram_payment_note', '"Send withdrawals to the Gram wallet address supplied by the user."'::jsonb)
on conflict (key) do nothing;

create table if not exists public.easygram_tasks (
  id bigserial primary key,
  title text not null,
  description text not null default '',
  kind text not null check (kind in ('ad','link','channel','bot')),
  reward_gram numeric(20, 8) not null default 0 check (reward_gram >= 0),
  url text,
  chat_id text,
  max_completions integer not null default 1 check (max_completions >= 0), -- 0 = unlimited
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists easygram_tasks_active_sort_idx on public.easygram_tasks (is_active, sort_order, created_at desc);

create table if not exists public.easygram_task_completions (
  id bigserial primary key,
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  task_id bigint not null references public.easygram_tasks(id) on delete cascade,
  completion_count integer not null default 1,
  last_completed_at timestamptz not null default now(),
  unique (telegram_id, task_id)
);

create table if not exists public.easygram_task_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  task_id bigint not null references public.easygram_tasks(id) on delete cascade,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz
);

create index if not exists easygram_task_sessions_user_idx on public.easygram_task_sessions (telegram_id, task_id, opened_at desc);

create table if not exists public.easygram_ad_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  placement text not null check (placement in ('task','withdrawal')),
  block_id text not null,
  started_at timestamptz not null default now(),
  confirmed_at timestamptz,
  pulse_away boolean not null default false,
  away_ms integer not null default 0,
  used_at timestamptz
);

create index if not exists easygram_ad_sessions_user_idx on public.easygram_ad_sessions (telegram_id, confirmed_at desc);

create table if not exists public.easygram_withdrawals (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete restrict,
  amount_gram numeric(20, 8) not null check (amount_gram > 0),
  wallet_address text not null,
  status text not null default 'pending' check (status in ('pending','completed','rejected')),
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists easygram_withdrawals_user_idx on public.easygram_withdrawals (telegram_id, created_at desc);
create index if not exists easygram_withdrawals_pending_idx on public.easygram_withdrawals (status, created_at asc);

create table if not exists public.easygram_referrals (
  id bigserial primary key,
  referrer_id text not null references public.easygram_users(telegram_id) on delete cascade,
  referred_id text not null unique references public.easygram_users(telegram_id) on delete cascade,
  reward_gram numeric(20, 8) not null default 0,
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

create table if not exists public.easygram_audit_logs (
  id bigserial primary key,
  actor_telegram_id text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Prevent direct access from anon/authenticated clients. The backend uses
-- the Supabase service-role key and calls the functions below.
do $$
declare t text;
begin
  foreach t in array array[
    'easygram_users','easygram_admins','easygram_settings','easygram_tasks',
    'easygram_task_completions','easygram_task_sessions','easygram_ad_sessions',
    'easygram_withdrawals','easygram_referrals','easygram_audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Add a referral once only and reward the referrer atomically.
create or replace function public.easygram_award_referral(
  p_referrer_id text,
  p_referred_id text,
  p_reward numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare inserted_id bigint;
begin
  if p_referrer_id is null or p_referred_id is null or p_referrer_id = p_referred_id then
    return false;
  end if;
  if not exists (select 1 from easygram_users where telegram_id = p_referrer_id) then
    return false;
  end if;
  insert into easygram_referrals (referrer_id, referred_id, reward_gram)
  values (p_referrer_id, p_referred_id, greatest(coalesce(p_reward, 0), 0))
  on conflict (referred_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return false; end if;
  update easygram_users
     set balance_gram = balance_gram + greatest(coalesce(p_reward, 0), 0)
   where telegram_id = p_referrer_id;
  return true;
end;
$$;

-- Increment withdrawal-ad progress. Called only after the ad pulse passes.
create or replace function public.easygram_increment_withdrawal_ads(p_telegram_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare current_count integer;
begin
  update easygram_users
     set withdrawal_ads_watched = withdrawal_ads_watched + 1
   where telegram_id = p_telegram_id
  returning withdrawal_ads_watched into current_count;
  if current_count is null then raise exception 'User not found'; end if;
  return current_count;
end;
$$;

-- Atomically consume one task session or one confirmed ad session and grant
-- the task reward. A max_completions value of 0 means unlimited completions.
create or replace function public.easygram_complete_task(
  p_telegram_id text,
  p_task_id bigint,
  p_task_session_id uuid default null,
  p_ad_session_id uuid default null
) returns table(reward_gram numeric, balance_gram numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task easygram_tasks%rowtype;
  v_user easygram_users%rowtype;
  v_count integer;
  v_consumed uuid;
  v_min_watch_seconds integer := 5;
begin
  select coalesce((value #>> '{}')::integer, 5) into v_min_watch_seconds
    from easygram_settings where key = 'task_min_watch_seconds';
  v_min_watch_seconds := greatest(5, least(coalesce(v_min_watch_seconds, 5), 60));

  select * into v_task from easygram_tasks where id = p_task_id and is_active = true for update;
  if not found then raise exception 'Task is unavailable'; end if;

  select * into v_user from easygram_users where telegram_id = p_telegram_id for update;
  if not found then raise exception 'User not found'; end if;

  select coalesce(completion_count, 0) into v_count
    from easygram_task_completions
   where telegram_id = p_telegram_id and task_id = p_task_id;
  v_count := coalesce(v_count, 0);
  if v_task.max_completions > 0 and v_count >= v_task.max_completions then
    raise exception 'Task completion limit reached';
  end if;

  if v_task.kind = 'ad' then
    update easygram_ad_sessions
       set used_at = now()
     where id = p_ad_session_id
       and telegram_id = p_telegram_id
       and placement = 'task'
       and confirmed_at is not null
       and used_at is null
       and started_at > now() - interval '10 minutes'
    returning id into v_consumed;
    if v_consumed is null then raise exception 'A verified task ad is required'; end if;
  else
    update easygram_task_sessions
       set used_at = now()
     where id = p_task_session_id
       and telegram_id = p_telegram_id
       and task_id = p_task_id
       and used_at is null
       and expires_at > now()
       and opened_at <= now() - make_interval(secs => v_min_watch_seconds)
    returning id into v_consumed;
    if v_consumed is null then raise exception 'Open the task and wait at least 5 seconds before verifying'; end if;
  end if;

  insert into easygram_task_completions (telegram_id, task_id, completion_count, last_completed_at)
  values (p_telegram_id, p_task_id, 1, now())
  on conflict (telegram_id, task_id) do update
    set completion_count = easygram_task_completions.completion_count + 1,
        last_completed_at = now();

  update easygram_users as user_row
     set balance_gram = user_row.balance_gram + v_task.reward_gram
   where user_row.telegram_id = p_telegram_id
  returning user_row.balance_gram into balance_gram;

  reward_gram := v_task.reward_gram;
  return next;
end;
$$;

-- Create a Gram withdrawal, deduct balance and reset the five-ad counter
-- in one transaction. Only one pending withdrawal is allowed per user.
create or replace function public.easygram_create_withdrawal(
  p_telegram_id text,
  p_amount numeric,
  p_wallet_address text,
  p_minimum numeric,
  p_ads_required integer
) returns setof easygram_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user easygram_users%rowtype;
  v_withdrawal easygram_withdrawals%rowtype;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid withdrawal amount'; end if;
  if p_amount < greatest(coalesce(p_minimum, 0), 0) then raise exception 'Minimum withdrawal is % GRAM', p_minimum; end if;
  if length(trim(coalesce(p_wallet_address, ''))) < 10 then raise exception 'Enter a valid Gram wallet address'; end if;

  select * into v_user from easygram_users where telegram_id = p_telegram_id for update;
  if not found then raise exception 'User not found'; end if;
  if exists (select 1 from easygram_withdrawals where telegram_id = p_telegram_id and status = 'pending') then
    raise exception 'You already have a pending withdrawal';
  end if;
  if v_user.withdrawal_ads_watched < greatest(coalesce(p_ads_required, 5), 1) then
    raise exception 'Watch % withdrawal ads before requesting a payout', greatest(coalesce(p_ads_required, 5), 1);
  end if;
  if v_user.balance_gram < p_amount then raise exception 'Insufficient GRAM balance'; end if;

  update easygram_users
     set balance_gram = balance_gram - p_amount,
         withdrawal_ads_watched = 0
   where telegram_id = p_telegram_id;

  insert into easygram_withdrawals (telegram_id, amount_gram, wallet_address, status)
  values (p_telegram_id, p_amount, trim(p_wallet_address), 'pending')
  returning * into v_withdrawal;
  return next v_withdrawal;
end;
$$;

-- Approve or reject one pending payout. Rejections return the full amount.
create or replace function public.easygram_review_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_admin_id text,
  p_admin_note text default null
) returns setof easygram_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal easygram_withdrawals%rowtype;
begin
  select * into v_withdrawal from easygram_withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status <> 'pending' then raise exception 'This withdrawal has already been reviewed'; end if;
  if p_action not in ('approve','reject') then raise exception 'Invalid review action'; end if;

  if p_action = 'reject' then
    update easygram_users
       set balance_gram = balance_gram + v_withdrawal.amount_gram
     where telegram_id = v_withdrawal.telegram_id;
    update easygram_withdrawals
       set status = 'rejected', admin_note = p_admin_note,
           reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
     where id = p_withdrawal_id
    returning * into v_withdrawal;
  else
    update easygram_withdrawals
       set status = 'completed', admin_note = p_admin_note,
           reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
     where id = p_withdrawal_id
    returning * into v_withdrawal;
  end if;
  insert into easygram_audit_logs (actor_telegram_id, action, details)
  values (p_admin_id, 'review_withdrawal', jsonb_build_object('withdrawal_id', p_withdrawal_id, 'decision', p_action));
  return next v_withdrawal;
end;
$$;

-- The server is the only caller for these SECURITY DEFINER procedures.
revoke all on function public.easygram_award_referral(text,text,numeric) from public, anon, authenticated;
revoke all on function public.easygram_increment_withdrawal_ads(text) from public, anon, authenticated;
revoke all on function public.easygram_complete_task(text,bigint,uuid,uuid) from public, anon, authenticated;
revoke all on function public.easygram_create_withdrawal(text,numeric,text,numeric,integer) from public, anon, authenticated;
revoke all on function public.easygram_review_withdrawal(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.easygram_award_referral(text,text,numeric) to service_role;
grant execute on function public.easygram_increment_withdrawal_ads(text) to service_role;
grant execute on function public.easygram_complete_task(text,bigint,uuid,uuid) to service_role;
grant execute on function public.easygram_create_withdrawal(text,numeric,text,numeric,integer) to service_role;
grant execute on function public.easygram_review_withdrawal(uuid,text,text,text) to service_role;

-- Owner access is controlled by ADMIN_SECRET in the server environment.
-- No OWNER_TELEGRAM_ID or owner row is required.
-- Add moderators from /admin after signing in with ADMIN_SECRET.

-- =============================================================
-- Easy Gram expansion: clock mining, required subscriptions,
-- member moderation and audit tracking.
-- Safe to run on an existing Easy Gram database.
-- =============================================================

alter table public.easygram_users
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz;

insert into public.easygram_settings (key, value) values
  ('mining_rate_per_hour', '0.02'::jsonb),
  ('mining_duration_hours', '6'::jsonb)
on conflict (key) do nothing;

create table if not exists public.easygram_mining_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  rate_per_hour numeric(20,8) not null check (rate_per_hour >= 0),
  duration_hours numeric(8,2) not null check (duration_hours > 0),
  reward_gram numeric(20,8) not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists easygram_one_unclaimed_mining_per_user
  on public.easygram_mining_sessions (telegram_id)
  where claimed_at is null;
create index if not exists easygram_mining_user_history_idx
  on public.easygram_mining_sessions (telegram_id, started_at desc);

create table if not exists public.easygram_required_channels (
  id bigserial primary key,
  title text not null,
  chat_id text not null unique,
  join_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists easygram_required_channels_active_idx
  on public.easygram_required_channels (is_active, created_at);

alter table public.easygram_mining_sessions enable row level security;
alter table public.easygram_required_channels enable row level security;

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
  if not exists (
    select 1 from easygram_users
    where telegram_id = p_telegram_id and is_banned = false
  ) then
    raise exception 'User not found or suspended';
  end if;

  v_rate := greatest(0, least(coalesce(p_rate_per_hour, 0.02), 100));
  v_duration := greatest(1, least(coalesce(p_duration_hours, 6), 24));

  perform 1 from easygram_users where telegram_id = p_telegram_id for update;

  select mining_row.* into v_session
  from public.easygram_mining_sessions as mining_row
  where mining_row.telegram_id = p_telegram_id
    and mining_row.claimed_at is null
  order by mining_row.started_at desc
  limit 1
  for update;

  if found then
    return next v_session;
    return;
  end if;

  insert into easygram_mining_sessions (
    telegram_id, started_at, ends_at, rate_per_hour, duration_hours
  ) values (
    p_telegram_id,
    now(),
    now() + make_interval(secs => (v_duration * 3600)::integer),
    v_rate,
    v_duration
  ) returning * into v_session;

  return next v_session;
end;
$$;

create or replace function public.easygram_claim_mining(
  p_telegram_id text
) returns table(
  reward_gram numeric,
  balance_gram numeric,
  started_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.easygram_mining_sessions%rowtype;
  v_balance numeric(20,8);
  v_reward numeric(20,8);
begin
  select mining_row.* into v_session
  from public.easygram_mining_sessions as mining_row
  where mining_row.telegram_id = p_telegram_id
    and mining_row.claimed_at is null
  order by mining_row.started_at desc
  limit 1
  for update;

  if not found then raise exception 'No active mining session'; end if;
  if now() < v_session.ends_at then
    raise exception 'Mining is not finished yet';
  end if;

  v_reward := round(v_session.rate_per_hour * v_session.duration_hours, 8);

  update easygram_mining_sessions
  set claimed_at = now(), reward_gram = v_reward
  where id = v_session.id and claimed_at is null;

  if not found then raise exception 'Mining reward was already claimed'; end if;

  update easygram_users as user_row
  set balance_gram = user_row.balance_gram + v_reward
  where user_row.telegram_id = p_telegram_id
  returning user_row.balance_gram into v_balance;

  reward_gram := v_reward;
  balance_gram := v_balance;
  started_at := v_session.started_at;
  ends_at := v_session.ends_at;
  return next;
end;
$$;

revoke all on function public.easygram_start_mining(text,numeric,numeric) from public, anon, authenticated;
revoke all on function public.easygram_claim_mining(text) from public, anon, authenticated;
grant execute on function public.easygram_start_mining(text,numeric,numeric) to service_role;
grant execute on function public.easygram_claim_mining(text) to service_role;

-- Support private and public channel IDs for join-channel tasks.
alter table public.easygram_tasks add column if not exists chat_id text;


-- =========================================================
-- EASY GRAM V3 UPGRADE: MINING GATES + AUTOMATIC ADS
-- Safe to run on an existing Easy Gram database.
-- =========================================================

alter table public.easygram_ad_sessions
  drop constraint if exists easygram_ad_sessions_placement_check;

alter table public.easygram_ad_sessions
  add constraint easygram_ad_sessions_placement_check
  check (placement in ('task','withdrawal','mining_start','mining_claim'));

insert into public.easygram_settings(key,value) values
  ('auto_ads_enabled','true'::jsonb),
  ('auto_ads_interval_seconds','30'::jsonb),
  ('mining_rate_per_hour','0.02'::jsonb),
  ('mining_duration_hours','6'::jsonb)
on conflict(key) do nothing;

-- Ensure the forced channel and mining tables are available on older installs.
create table if not exists public.easygram_mining_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  rate_per_hour numeric(20,8) not null check(rate_per_hour >= 0),
  duration_hours numeric(8,2) not null check(duration_hours > 0),
  reward_gram numeric(20,8) not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists easygram_one_unclaimed_mining_per_user
on public.easygram_mining_sessions(telegram_id)
where claimed_at is null;

create table if not exists public.easygram_required_channels (
  id bigserial primary key,
  title text not null,
  chat_id text not null unique,
  join_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.easygram_mining_sessions enable row level security;
alter table public.easygram_required_channels enable row level security;


-- =========================================================
-- EASY GRAM V5 UPGRADE
-- Referral rewards are credited only after the invited user
-- completes the configured number of DIFFERENT tasks.
-- Existing already-paid referrals stay paid and are not re-awarded.
-- =========================================================

insert into public.easygram_settings(key, value) values
  ('referral_tasks_required', '3'::jsonb)
on conflict (key) do nothing;

alter table public.easygram_referrals
  add column if not exists status text not null default 'paid',
  add column if not exists required_tasks integer not null default 0,
  add column if not exists qualified_at timestamptz;

do $$
begin
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

create index if not exists easygram_referrals_referrer_status_idx
  on public.easygram_referrals(referrer_id, status, created_at desc);

-- Replaces the old immediate-payment behavior. This now creates a pending
-- referral; the reward is not credited at registration time.
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
  if p_referrer_id is null or p_referred_id is null
     or p_referrer_id = p_referred_id then
    return false;
  end if;

  if not exists (select 1 from public.easygram_users where telegram_id = p_referrer_id) then
    return false;
  end if;

  select greatest(1, least(coalesce((value #>> '{}')::integer, 3), 50))
    into v_required_tasks
  from public.easygram_settings
  where key = 'referral_tasks_required';
  v_required_tasks := greatest(1, least(coalesce(v_required_tasks, 3), 50));

  insert into public.easygram_referrals(
    referrer_id, referred_id, reward_gram, status, required_tasks
  ) values (
    p_referrer_id,
    p_referred_id,
    greatest(coalesce(p_reward, 0), 0),
    'pending',
    v_required_tasks
  )
  on conflict (referred_id) do nothing
  returning id into inserted_id;

  return inserted_id is not null;
end;
$$;

-- Idempotently pays a pending referral after enough distinct task records exist.
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

  if not found or v_referral.status <> 'pending' then
    return false;
  end if;

  -- One row per distinct task ID; repeat completions of one task count once.
  select count(*)::integer into v_completed_tasks
  from public.easygram_task_completions
  where telegram_id = p_referred_id
    and completion_count > 0;

  if v_completed_tasks < greatest(v_referral.required_tasks, 1) then
    return false;
  end if;

  update public.easygram_referrals
  set status = 'paid', qualified_at = now()
  where id = v_referral.id and status = 'pending';

  if not found then
    return false;
  end if;

  update public.easygram_users
  set balance_gram = balance_gram + v_referral.reward_gram
  where telegram_id = v_referral.referrer_id;

  return true;
end;
$$;

revoke all on function public.easygram_award_referral(text,text,numeric)
  from public, anon, authenticated;
revoke all on function public.easygram_qualify_referral(text)
  from public, anon, authenticated;
grant execute on function public.easygram_award_referral(text,text,numeric)
  to service_role;
grant execute on function public.easygram_qualify_referral(text)
  to service_role;

-- Add an index to keep member activity lookups fast.
create index if not exists easygram_users_last_seen_idx
  on public.easygram_users(last_seen_at desc);

-- =========================================================
-- ADSGRAM + MINING RELIABILITY PATCH
-- Safe to rerun on an existing Easy Gram database.
-- =========================================================

-- Compatibility columns used by the current API and mining wrappers.
alter table public.easygram_users
  add column if not exists is_banned boolean not null default false,
  add column if not exists withdrawal_ads_watched integer not null default 0;
alter table public.easygram_tasks
  add column if not exists chat_id text;

-- Older installations may still have the original two-placement check.
alter table public.easygram_ad_sessions
  add column if not exists confirmed_at timestamptz,
  add column if not exists pulse_away boolean not null default false,
  add column if not exists away_ms integer not null default 0,
  add column if not exists used_at timestamptz,
  add column if not exists block_id text;

alter table public.easygram_ad_sessions
  drop constraint if exists easygram_ad_sessions_placement_check;

alter table public.easygram_ad_sessions
  add constraint easygram_ad_sessions_placement_check
  check (placement in ('task','withdrawal','mining_start','mining_claim'));

create index if not exists easygram_ad_sessions_user_idx
  on public.easygram_ad_sessions (telegram_id, confirmed_at desc);
create index if not exists easygram_ad_sessions_pending_idx
  on public.easygram_ad_sessions (telegram_id, started_at desc)
  where confirmed_at is null;

-- Ensure the timed mining table exists on installations upgraded from older builds.
create table if not exists public.easygram_mining_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null references public.easygram_users(telegram_id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  rate_per_hour numeric(20,8) not null check (rate_per_hour >= 0),
  duration_hours numeric(8,2) not null check (duration_hours > 0),
  reward_gram numeric(20,8) not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists easygram_one_unclaimed_mining_per_user
  on public.easygram_mining_sessions (telegram_id)
  where claimed_at is null;
create index if not exists easygram_mining_user_history_idx
  on public.easygram_mining_sessions (telegram_id, started_at desc);
alter table public.easygram_mining_sessions enable row level security;

-- Confirm a rewarded ad and, for withdrawal ads, increment the counter in
-- the SAME transaction. A retry of the same unconsumed session is idempotent.
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer);
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer,boolean);

create or replace function public.easygram_confirm_ad_session(
  p_session_id uuid,
  p_telegram_id text,
  p_placement text,
  p_away_ms integer,
  p_pulse_away boolean
) returns table(
  session_id uuid,
  placement text,
  withdrawal_ads_watched integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.easygram_ad_sessions%rowtype;
  v_count integer := null;
  v_elapsed_ms bigint;
begin
  if p_placement not in ('task','withdrawal','mining_start','mining_claim') then
    raise exception 'Invalid ad placement';
  end if;
  if coalesce(p_away_ms, 0) < 4500 then
    raise exception 'Watch the ad for at least 5 seconds';
  end if;

  select * into v_session
  from public.easygram_ad_sessions
  where id = p_session_id and telegram_id = p_telegram_id
  for update;

  if not found or v_session.placement <> p_placement then
    raise exception 'This ad session is invalid';
  end if;
  if v_session.used_at is not null then
    raise exception 'This ad session has already been used';
  end if;

  -- A retried confirmation must not add a second withdrawal-ad credit.
  if v_session.confirmed_at is not null then
    if v_session.placement = 'withdrawal' then
      select u.withdrawal_ads_watched into v_count
      from public.easygram_users u
      where u.telegram_id = p_telegram_id;
    end if;
    return query select v_session.id, v_session.placement, v_count;
    return;
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;
  if v_elapsed_ms < 4500 or v_elapsed_ms > 600000 then
    raise exception 'Ad session expired or was confirmed too early';
  end if;

  update public.easygram_ad_sessions
  set confirmed_at = now(), pulse_away = coalesce(p_pulse_away, false), away_ms = greatest(0, p_away_ms)
  where id = p_session_id and telegram_id = p_telegram_id;

  if p_placement = 'withdrawal' then
    update public.easygram_users
    set withdrawal_ads_watched = withdrawal_ads_watched + 1
    where telegram_id = p_telegram_id
    returning withdrawal_ads_watched into v_count;
    if v_count is null then raise exception 'User not found'; end if;
  end if;

  return query select p_session_id, p_placement, v_count;
end;
$$;

-- Consume the mining ad and start the session atomically. If mining cannot
-- start, PostgreSQL rolls the ad consumption back with the transaction.
create or replace function public.easygram_start_mining_with_ad(
  p_telegram_id text,
  p_rate_per_hour numeric,
  p_duration_hours numeric,
  p_ad_session_id uuid
) returns setof public.easygram_mining_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad public.easygram_ad_sessions%rowtype;
begin
  perform 1 from public.easygram_users
  where telegram_id = p_telegram_id and is_banned = false
  for update;
  if not found then raise exception 'User not found or suspended'; end if;

  if exists (
    select 1 from public.easygram_mining_sessions
    where telegram_id = p_telegram_id and claimed_at is null
  ) then
    raise exception 'You already have an active mining session. Claim it when it finishes.';
  end if;

  select ad_row.* into v_ad
  from public.easygram_ad_sessions as ad_row
  where ad_row.id = p_ad_session_id
    and ad_row.telegram_id = p_telegram_id
    and ad_row.placement = 'mining_start'
    and ad_row.confirmed_at is not null
    and ad_row.used_at is null
    and ad_row.started_at > now() - interval '10 minutes'
  for update;
  if not found then raise exception 'A verified mining-start ad is required'; end if;

  update public.easygram_ad_sessions set used_at = now()
  where id = p_ad_session_id and used_at is null;

  return query
  select * from public.easygram_start_mining(
    p_telegram_id, p_rate_per_hour, p_duration_hours
  );
end;
$$;

-- Consume the claim ad and credit the mining reward atomically.
create or replace function public.easygram_claim_mining_with_ad(
  p_telegram_id text,
  p_ad_session_id uuid
) returns table(
  reward_gram numeric,
  balance_gram numeric,
  started_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mining public.easygram_mining_sessions%rowtype;
  v_ad public.easygram_ad_sessions%rowtype;
begin
  perform 1 from public.easygram_users
  where telegram_id = p_telegram_id and is_banned = false
  for update;
  if not found then raise exception 'User not found or suspended'; end if;

  select mining_row.* into v_mining
  from public.easygram_mining_sessions as mining_row
  where mining_row.telegram_id = p_telegram_id
    and mining_row.claimed_at is null
  order by mining_row.started_at desc
  limit 1
  for update;
  if not found then raise exception 'No active mining session'; end if;
  if now() < v_mining.ends_at then raise exception 'Mining is not finished yet'; end if;

  select ad_row.* into v_ad
  from public.easygram_ad_sessions as ad_row
  where ad_row.id = p_ad_session_id
    and ad_row.telegram_id = p_telegram_id
    and ad_row.placement = 'mining_claim'
    and ad_row.confirmed_at is not null
    and ad_row.used_at is null
    and ad_row.started_at > now() - interval '10 minutes'
  for update;
  if not found then raise exception 'A verified mining-claim ad is required'; end if;

  update public.easygram_ad_sessions set used_at = now()
  where id = p_ad_session_id and used_at is null;

  return query select * from public.easygram_claim_mining(p_telegram_id);
end;
$$;

revoke all on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.easygram_start_mining_with_ad(text,numeric,numeric,uuid)
  from public, anon, authenticated;
revoke all on function public.easygram_claim_mining_with_ad(text,uuid)
  from public, anon, authenticated;
grant execute on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean)
  to service_role;
grant execute on function public.easygram_start_mining_with_ad(text,numeric,numeric,uuid)
  to service_role;
grant execute on function public.easygram_claim_mining_with_ad(text,uuid)
  to service_role;


-- EASY GRAM ADS TASK 6-HOUR COOLDOWN PATCH
-- Easy GRAM: 6-hour repeatable AdsGram task cooldown.
-- Safe to run more than once. Existing completion history and balances are preserved.
-- Ad tasks become claimable once every 6 hours; their max_completions setting
-- is intentionally ignored. All other task kinds keep their configured limits.

create or replace function public.easygram_complete_task(
  p_telegram_id text,
  p_task_id bigint,
  p_task_session_id uuid default null,
  p_ad_session_id uuid default null
) returns table(reward_gram numeric, balance_gram numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.easygram_tasks%rowtype;
  v_user public.easygram_users%rowtype;
  v_count integer := 0;
  v_last_completed_at timestamptz := null;
  v_consumed uuid;
  v_min_watch_seconds integer := 5;
begin
  select coalesce((setting.value #>> '{}')::integer, 5)
    into v_min_watch_seconds
    from public.easygram_settings as setting
   where setting.key = 'task_min_watch_seconds';
  v_min_watch_seconds := greatest(5, least(coalesce(v_min_watch_seconds, 5), 60));

  select task_row.*
    into v_task
    from public.easygram_tasks as task_row
   where task_row.id = p_task_id
     and task_row.is_active = true
   for update;
  if not found then raise exception 'Task is unavailable'; end if;

  select user_row.*
    into v_user
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
   for update;
  if not found then raise exception 'User not found'; end if;

  select coalesce(completion_row.completion_count, 0), completion_row.last_completed_at
    into v_count, v_last_completed_at
    from public.easygram_task_completions as completion_row
   where completion_row.telegram_id = p_telegram_id
     and completion_row.task_id = p_task_id
   for update;
  if not found then
    v_count := 0;
    v_last_completed_at := null;
  end if;

  if v_task.kind = 'ad' then
    if v_last_completed_at is not null
       and v_last_completed_at > now() - interval '6 hours' then
      raise exception 'Ad task is available every 6 hours';
    end if;
  elsif v_task.max_completions > 0 and v_count >= v_task.max_completions then
    raise exception 'Task completion limit reached';
  end if;

  if v_task.kind = 'ad' then
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
    (telegram_id, task_id, completion_count, last_completed_at)
  values (p_telegram_id, p_task_id, 1, now())
  on conflict (telegram_id, task_id) do update
    set completion_count = completion_row.completion_count + 1,
        last_completed_at = excluded.last_completed_at;

  update public.easygram_users as user_row
     set balance_gram = user_row.balance_gram + v_task.reward_gram
   where user_row.telegram_id = p_telegram_id
  returning user_row.balance_gram into balance_gram;

  reward_gram := v_task.reward_gram;
  return next;
end;
$$;

revoke all on function public.easygram_complete_task(text,bigint,uuid,uuid) from public, anon, authenticated;
grant execute on function public.easygram_complete_task(text,bigint,uuid,uuid) to service_role;

-- Quick verification query: this should show every ad task and its current max setting.
-- max_completions is ignored for kind='ad'; the 6-hour database cooldown is authoritative.
select id, title, kind, max_completions, is_active
from public.easygram_tasks
where kind = 'ad'
order by sort_order, id;
-- Latest task behavior: configurable ad batches and per-task cooldowns.
-- Easy GRAM: configurable ad-task batches and cooldowns.
-- Example: max_completions = 6, cooldown_hours = 5.
-- Users earn six rewards, then the same task is unavailable for five hours.
-- Existing balances and cumulative completion_count values are preserved.
-- New per-user cycle counters start at zero when this migration is first applied.

alter table public.easygram_tasks
  add column if not exists cooldown_hours integer not null default 5;

alter table public.easygram_task_completions
  add column if not exists cycle_count integer not null default 0,
  add column if not exists cooldown_until timestamptz;

alter table public.easygram_tasks
  alter column cooldown_hours set default 5;
alter table public.easygram_task_completions
  alter column cycle_count set default 0;

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
end;
$$;

create or replace function public.easygram_complete_task(
  p_telegram_id text,
  p_task_id bigint,
  p_task_session_id uuid default null,
  p_ad_session_id uuid default null
) returns table(reward_gram numeric, balance_gram numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.easygram_tasks%rowtype;
  v_user public.easygram_users%rowtype;
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

  select task_row.*
    into v_task
    from public.easygram_tasks as task_row
   where task_row.id = p_task_id
     and task_row.is_active = true
   for update;
  if not found then raise exception 'Task is unavailable'; end if;

  select user_row.*
    into v_user
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
   for update;
  if not found then raise exception 'User not found'; end if;

  select completion_row.completion_count,
         completion_row.cycle_count,
         completion_row.cooldown_until
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
    if v_task.max_completions > 0 and v_cooldown_until is not null
       and v_cooldown_until > now() then
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
    if v_consumed is null then
      raise exception 'A verified task ad is required';
    end if;
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
    if v_consumed is null then
      raise exception 'Open the task and wait at least 5 seconds before verifying';
    end if;
  end if;

  insert into public.easygram_task_completions as completion_row
    (telegram_id, task_id, completion_count, last_completed_at, cycle_count, cooldown_until)
  values (
    p_telegram_id,
    p_task_id,
    1,
    now(),
    case
      when v_task.kind = 'ad' and v_task.max_completions = 1 then 0
      when v_task.kind = 'ad' and v_task.max_completions > 1 then 1
      else 0
    end,
    case
      when v_task.kind = 'ad' and v_task.max_completions = 1
        then now() + make_interval(hours => v_task.cooldown_hours)
      else null
    end
  )
  on conflict (telegram_id, task_id) do update
    set completion_count = completion_row.completion_count + 1,
        last_completed_at = excluded.last_completed_at,
        cycle_count = case
          when v_task.kind = 'ad' and v_task.max_completions = 0 then 0
          when v_task.kind = 'ad' and v_task.max_completions > 0 then
            case
              when completion_row.cycle_count + 1 >= v_task.max_completions then 0
              else completion_row.cycle_count + 1
            end
          else completion_row.cycle_count
        end,
        cooldown_until = case
          when v_task.kind = 'ad' and v_task.max_completions = 0 then null
          when v_task.kind = 'ad'
           and v_task.max_completions > 0
           and completion_row.cycle_count + 1 >= v_task.max_completions
            then now() + make_interval(hours => v_task.cooldown_hours)
          when v_task.kind = 'ad' and v_task.max_completions > 0 then null
          else completion_row.cooldown_until
        end;

  update public.easygram_users as user_row
     set balance_gram = user_row.balance_gram + v_task.reward_gram
   where user_row.telegram_id = p_telegram_id
  returning user_row.balance_gram into balance_gram;

  reward_gram := v_task.reward_gram;
  return next;
end;
$$;

revoke all on function public.easygram_complete_task(text,bigint,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.easygram_complete_task(text,bigint,uuid,uuid)
  to service_role;

notify pgrst, 'reload schema';

-- Verification: tasks show the batch size and cooldown configured by the admin.
select id, title, kind, max_completions as ads_per_batch, cooldown_hours, is_active
  from public.easygram_tasks
 where kind = 'ad'
 order by sort_order, id;


-- =============================================================
-- EASY GRAM — AdsGram Native Task reward verification
-- Run once in Supabase SQL Editor.
-- =============================================================

alter table public.easygram_users
  add column if not exists adsgram_native_task_verified_at timestamptz;

insert into public.easygram_settings (key, value) values
  ('adsgram_native_task_block', '""'::jsonb),
  ('adsgram_native_task_reward_gram', '0.01'::jsonb)
on conflict (key) do nothing;

create index if not exists easygram_users_native_task_verified_idx
  on public.easygram_users (telegram_id)
  where adsgram_native_task_verified_at is not null;

-- Atomic single-use claim: only a verified AdsGram Reward URL callback
-- can be exchanged for the configured GRAM reward, and the timestamp is
-- cleared in the same UPDATE to prevent two parallel claims.
create or replace function public.easygram_claim_adsgram_native_task(
  p_telegram_id text,
  p_reward numeric
) returns table(
  balance_gram numeric,
  reward_gram numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_telegram_id is null
     or p_reward is null
     or p_reward <= 0
     or p_reward > 1000000 then
    return;
  end if;

  return query
    update public.easygram_users as u
       set balance_gram = u.balance_gram + p_reward,
           adsgram_native_task_verified_at = null
     where u.telegram_id = p_telegram_id
       and u.adsgram_native_task_verified_at is not null
    returning u.balance_gram, p_reward;
end;
$$;

revoke all on function public.easygram_claim_adsgram_native_task(text, numeric) from public;
revoke all on function public.easygram_claim_adsgram_native_task(text, numeric) from anon;
revoke all on function public.easygram_claim_adsgram_native_task(text, numeric) from authenticated;
grant execute on function public.easygram_claim_adsgram_native_task(text, numeric) to service_role;

notify pgrst, 'reload schema';
