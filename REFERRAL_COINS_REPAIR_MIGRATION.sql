-- =============================================================
-- EASY GRAM — Referral repair (Coins wallet)
-- Run once in Supabase SQL Editor after easygram_coins_usdt_migration.sql.
-- Safe to re-run. Repairs missing referral rows from easygram_users.referred_by,
-- retries pending rewards, and makes new referral rewards credit coin_balance.
-- =============================================================

begin;

alter table public.easygram_referrals
  add column if not exists status text not null default 'paid',
  add column if not exists required_tasks integer not null default 0,
  add column if not exists qualified_at timestamptz,
  add column if not exists reward_coins bigint;

update public.easygram_referrals
   set reward_coins = greatest(0, round(coalesce(reward_gram, 0) * 1000000)::bigint)
 where reward_coins is null;

alter table public.easygram_referrals
  alter column reward_coins set default 0,
  alter column reward_coins set not null;

create index if not exists easygram_referrals_referrer_status_idx
  on public.easygram_referrals(referrer_id, status, created_at desc);

create index if not exists easygram_referrals_referred_status_idx
  on public.easygram_referrals(referred_id, status);

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

-- Pending referrals have not been paid yet. Normalize their amount to the
-- currently configured Coin reward (the older function stored Coins in the
-- legacy reward_gram field, which caused a unit mismatch).
do $$
declare
  v_reward_coins bigint := 50000;
begin
  select greatest(0, least(1000000000, coalesce((value #>> '{}')::numeric, 50000)))::bigint
    into v_reward_coins
    from public.easygram_settings
   where key = 'referral_reward_coins';
  v_reward_coins := coalesce(v_reward_coins, 50000);

  update public.easygram_referrals
     set reward_coins = v_reward_coins,
         reward_gram = v_reward_coins::numeric / 1000000
   where status = 'pending';
end $$;

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
  v_reward_coins bigint;
  v_required_tasks integer := 3;
  v_inserted_id bigint;
begin
  if p_referrer_id is null or p_referred_id is null
     or p_referrer_id = p_referred_id then
    return false;
  end if;

  if not exists (
    select 1 from public.easygram_users
     where telegram_id = p_referrer_id
  ) then
    return false;
  end if;

  -- Only accept a referral that was persisted at first registration.
  if not exists (
    select 1 from public.easygram_users
     where telegram_id = p_referred_id
       and referred_by = p_referrer_id
  ) then
    return false;
  end if;

  v_reward_coins := greatest(0, least(1000000000, trunc(coalesce(p_reward, 0))))::bigint;

  select greatest(1, least(50, coalesce((value #>> '{}')::integer, 3)))
    into v_required_tasks
    from public.easygram_settings
   where key = 'referral_tasks_required';
  v_required_tasks := greatest(1, least(50, coalesce(v_required_tasks, 3)));

  insert into public.easygram_referrals (
    referrer_id, referred_id, reward_gram, reward_coins, status, required_tasks
  ) values (
    p_referrer_id,
    p_referred_id,
    v_reward_coins::numeric / 1000000,
    v_reward_coins,
    'pending',
    v_required_tasks
  )
  on conflict (referred_id) do nothing
  returning id into v_inserted_id;

  return v_inserted_id is not null;
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
  v_updated integer;
begin
  select * into v_referral
    from public.easygram_referrals
   where referred_id = p_referred_id
   for update;

  if not found or v_referral.status <> 'pending' then
    return false;
  end if;

  select count(distinct task_id)::integer
    into v_completed_tasks
    from public.easygram_task_completions
   where telegram_id = p_referred_id
     and completion_count > 0;

  if v_completed_tasks < greatest(v_referral.required_tasks, 1) then
    return false;
  end if;

  update public.easygram_referrals
     set status = 'paid', qualified_at = now()
   where id = v_referral.id
     and status = 'pending';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  update public.easygram_users
     set coin_balance = coin_balance + greatest(coalesce(v_referral.reward_coins, 0), 0)
   where telegram_id = v_referral.referrer_id;

  if not found then
    raise exception 'Referral owner not found while crediting reward';
  end if;

  return true;
end;
$$;

-- Recover invitees whose user row saved referred_by but whose original RPC
-- failed or was interrupted. Existing referral rows are never duplicated.
do $$
declare
  v_reward_coins bigint := 50000;
  v_required_tasks integer := 3;
begin
  select greatest(0, least(1000000000, coalesce((value #>> '{}')::numeric, 50000)))::bigint
    into v_reward_coins
    from public.easygram_settings
   where key = 'referral_reward_coins';
  v_reward_coins := coalesce(v_reward_coins, 50000);

  select greatest(1, least(50, coalesce((value #>> '{}')::integer, 3)))
    into v_required_tasks
    from public.easygram_settings
   where key = 'referral_tasks_required';
  v_required_tasks := greatest(1, least(50, coalesce(v_required_tasks, 3)));

  insert into public.easygram_referrals (
    referrer_id, referred_id, reward_gram, reward_coins, status, required_tasks
  )
  select
    invited.referred_by,
    invited.telegram_id,
    v_reward_coins::numeric / 1000000,
    v_reward_coins,
    'pending',
    v_required_tasks
  from public.easygram_users as invited
  join public.easygram_users as inviter
    on inviter.telegram_id = invited.referred_by
  where invited.referred_by is not null
    and invited.referred_by <> invited.telegram_id
  on conflict (referred_id) do nothing;
end $$;

-- Apply rewards for repaired referrals whose invitees already completed
-- the required number of different tasks.
do $$
declare
  v_invitee record;
begin
  for v_invitee in
    select referred_id
      from public.easygram_referrals
     where status = 'pending'
  loop
    perform public.easygram_qualify_referral(v_invitee.referred_id);
  end loop;
end $$;

revoke all on function public.easygram_award_referral(text,text,numeric)
  from public, anon, authenticated;
revoke all on function public.easygram_qualify_referral(text)
  from public, anon, authenticated;
grant execute on function public.easygram_award_referral(text,text,numeric)
  to service_role;
grant execute on function public.easygram_qualify_referral(text)
  to service_role;

notify pgrst, 'reload schema';

select
  count(*) as total_referrals,
  count(*) filter (where status = 'pending') as pending_referrals,
  count(*) filter (where status = 'paid') as paid_referrals,
  coalesce(sum(reward_coins) filter (where status = 'pending'), 0) as pending_reward_coins
from public.easygram_referrals;

commit;
