-- =========================================================
-- EASY GRAM V5 MIGRATION — EXISTING V4 DATABASES
-- Safe to rerun. Does not delete users, balances, tasks or withdrawals.
-- Existing referral rows are marked paid by default to avoid double rewards.
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

  -- One completion row per unique task; repeat completions count once.
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

create index if not exists easygram_users_last_seen_idx
  on public.easygram_users(last_seen_at desc);
