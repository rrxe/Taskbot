-- =====================================================================
-- EASY GRAM — GRAM withdrawal option + player tracking + one-time reset
-- Run AFTER easygram_coins_usdt_migration.sql in the EasyGram Supabase DB.
-- Keeps existing BNB withdrawal history readable, but disables BNB for new requests.
-- Resets Coins, USDT and legacy GRAM balances once only; future reruns do not reset again.
-- =====================================================================
begin;

-- A) New withdrawals can use Binance or GRAM. Historical BNB rows remain valid.
alter table public.easygram_usdt_withdrawals
  drop constraint if exists easygram_usdt_withdrawals_method_check;
alter table public.easygram_usdt_withdrawals
  add constraint easygram_usdt_withdrawals_method_check
  check (method in ('binance','gram','bnb'));

create or replace function public.easygram_submit_usdt_withdrawal(
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
  if p_amount_usdt is null or p_amount_usdt < v_min then
    raise exception 'Minimum withdrawal is 0.1 USDT';
  end if;
  if p_amount_usdt > v_max then
    raise exception 'Maximum withdrawal is 0.2 USDT per request';
  end if;
  if p_method not in ('binance','gram') then
    raise exception 'Choose Binance or GRAM';
  end if;
  if length(trim(coalesce(p_target, ''))) < 6 or length(trim(coalesce(p_target, ''))) > 160 then
    raise exception 'Enter a valid withdrawal destination';
  end if;

  select * into v_user
    from public.easygram_users
   where telegram_id = p_telegram_id and coalesce(is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  if exists (
    select 1 from public.easygram_usdt_withdrawals
     where telegram_id = p_telegram_id and status = 'pending'
  ) then
    raise exception 'You already have a pending USDT withdrawal';
  end if;

  v_count := case
    when v_user.withdrawal_count_date = v_today then greatest(0, coalesce(v_user.withdrawals_today, 0))
    else 0
  end;
  v_required := 10 + (v_count * 10);
  if coalesce(v_user.withdrawal_ads_watched, 0) < v_required then
    raise exception 'Watch % withdrawal ads before requesting a payout', v_required;
  end if;
  if v_user.usdt_balance < p_amount_usdt then
    raise exception 'Insufficient USDT balance';
  end if;

  update public.easygram_users
     set usdt_balance = usdt_balance - p_amount_usdt,
         withdrawal_ads_watched = 0,
         withdrawals_today = v_count + 1,
         withdrawal_count_date = v_today
   where telegram_id = p_telegram_id;

  insert into public.easygram_usdt_withdrawals
    (telegram_id, amount_usdt, method, target, status)
  values
    (p_telegram_id, round(p_amount_usdt, 8), p_method, trim(p_target), 'pending')
  returning * into v_request;
  return next v_request;
end;
$$;

-- B) Aggregate player metrics inside PostgreSQL so the admin panel gets exact
-- all-time counts without the Supabase 1,000-row REST limit.
create or replace function public.easygram_admin_user_tracking(p_telegram_ids text[])
returns table (
  telegram_id text,
  tasks_completed bigint,
  distinct_tasks_completed bigint,
  referrals_joined bigint,
  referrals_rewarded bigint,
  referrals_pending bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.telegram_id,
    coalesce(task_stats.tasks_completed, 0)::bigint,
    coalesce(task_stats.distinct_tasks_completed, 0)::bigint,
    coalesce(joined_stats.referrals_joined, 0)::bigint,
    coalesce(referral_stats.referrals_rewarded, 0)::bigint,
    coalesce(referral_stats.referrals_pending, 0)::bigint
  from public.easygram_users u
  left join lateral (
    select
      coalesce(sum(c.completion_count), 0)::bigint as tasks_completed,
      count(*)::bigint as distinct_tasks_completed
    from public.easygram_task_completions c
    where c.telegram_id = u.telegram_id
  ) task_stats on true
  left join lateral (
    select count(*)::bigint as referrals_joined
    from public.easygram_users invited
    where invited.referred_by = u.telegram_id
  ) joined_stats on true
  left join lateral (
    select
      count(*) filter (where r.status = 'paid')::bigint as referrals_rewarded,
      count(*) filter (where r.status = 'pending')::bigint as referrals_pending
    from public.easygram_referrals r
    where r.referrer_id = u.telegram_id
  ) referral_stats on true
  where u.telegram_id = any(coalesce(p_telegram_ids, array[]::text[]));
$$;

revoke all on function public.easygram_admin_user_tracking(text[]) from public, anon, authenticated;
grant execute on function public.easygram_admin_user_tracking(text[]) to service_role;
revoke all on function public.easygram_submit_usdt_withdrawal(text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.easygram_submit_usdt_withdrawal(text,numeric,text,text) to service_role;

-- C) Zero ALL current player balances exactly once. This includes the old
-- balance_gram field and the new Coins / USDT wallets. Does not delete users,
-- task history, referrals, ad progress or pending withdrawal requests.
-- A setting marker protects future earnings if this SQL file is run again.
select pg_advisory_xact_lock(hashtext('easygram:all-player-balances-reset:v1'));
do $$
declare
  v_affected bigint := 0;
begin
  if not exists (
    select 1 from public.easygram_settings where key = 'all_player_balances_reset_at'
  ) then
    update public.easygram_users
       set coin_balance = 0,
           usdt_balance = 0,
           balance_gram = 0
     where coalesce(coin_balance, 0) <> 0
        or coalesce(usdt_balance, 0) <> 0
        or coalesce(balance_gram, 0) <> 0;
    get diagnostics v_affected = row_count;

    insert into public.easygram_settings (key, value, updated_at)
    values ('all_player_balances_reset_at', to_jsonb(now()::text), now())
    on conflict (key) do nothing;

    insert into public.easygram_audit_logs (actor_telegram_id, action, details)
    values (
      'SYSTEM_MIGRATION',
      'reset_all_player_balances',
      jsonb_build_object(
        'affected_users', v_affected,
        'balances', jsonb_build_array('coin_balance','usdt_balance','balance_gram'),
        'reset_at', now()
      )
    );
  end if;
end $$;

notify pgrst, 'reload schema';

-- Verify new withdrawal rule and reset marker.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.easygram_usdt_withdrawals'::regclass
   and conname = 'easygram_usdt_withdrawals_method_check';
select key, value from public.easygram_settings
 where key = 'all_player_balances_reset_at';
select count(*) as users_with_nonzero_wallets
  from public.easygram_users
 where coalesce(coin_balance,0) <> 0
    or coalesce(usdt_balance,0) <> 0
    or coalesce(balance_gram,0) <> 0;

commit;
