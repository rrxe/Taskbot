-- EASY GRAM — split AdsGram blocks into automatic and reward/action placements
-- Run once in Supabase SQL Editor before or after deploying the updated app.
-- Existing legacy settings are preserved and copied only when the new keys do not exist.

insert into public.easygram_settings (key, value)
select 'adsgram_auto_block', value
from public.easygram_settings
where key = 'adsgram_block_primary'
on conflict (key) do nothing;

insert into public.easygram_settings (key, value)
select 'adsgram_reward_block', value
from public.easygram_settings
where key = 'adsgram_block_secondary'
on conflict (key) do nothing;

-- Safe defaults for installations that did not have the old settings rows.
insert into public.easygram_settings (key, value)
values
  ('adsgram_auto_block', '"int-58010"'::jsonb),
  ('adsgram_reward_block', '"int-58009"'::jsonb)
on conflict (key) do nothing;

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
