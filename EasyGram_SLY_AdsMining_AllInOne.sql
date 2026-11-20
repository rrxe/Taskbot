-- ============================================================
-- EASY GRAM — SLY-style AdsGram + mining repair (all-in-one)
-- Safe to re-run. Does not delete users, balances, mining history,
-- ad sessions, or task completion history.
-- Run this entire file in Supabase SQL Editor for EASY GRAM.
-- ============================================================

-- 1) Schema compatibility for verified AdsGram sessions.
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

alter table public.easygram_users
  add column if not exists is_banned boolean not null default false,
  add column if not exists withdrawal_ads_watched integer not null default 0;

-- 2) Ensure timed mining storage exists (preserves existing rows).
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

create index if not exists easygram_mining_user_history_idx
  on public.easygram_mining_sessions (telegram_id, started_at desc);
alter table public.easygram_mining_sessions enable row level security;

-- Only create the one-active-session index when the current data allows it.
-- If duplicate active sessions exist, do not delete them automatically.
do $$
begin
  if not exists (
    select 1 from public.easygram_mining_sessions
    where claimed_at is null
    group by telegram_id having count(*) > 1
  ) then
    create unique index if not exists easygram_one_unclaimed_mining_per_user
      on public.easygram_mining_sessions (telegram_id)
      where claimed_at is null;
  else
    raise notice 'Multiple unclaimed mining sessions already exist for at least one user; unique index was not created. No history was deleted.';
  end if;
end $$;

-- 3) Explicitly-qualified base mining functions.
-- These definitions also fix ambiguous started_at references from older versions.
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
  perform 1
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  v_rate := greatest(0, least(coalesce(p_rate_per_hour, 0.02), 100));
  v_duration := greatest(1, least(coalesce(p_duration_hours, 6), 24));

  select mining_row.*
    into v_session
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

  insert into public.easygram_mining_sessions
    (telegram_id, started_at, ends_at, rate_per_hour, duration_hours)
  values
    (p_telegram_id, now(), now() + make_interval(secs => (v_duration * 3600)::integer), v_rate, v_duration)
  returning * into v_session;

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
  v_claimed_id uuid;
begin
  perform 1
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  select mining_row.*
    into v_session
    from public.easygram_mining_sessions as mining_row
   where mining_row.telegram_id = p_telegram_id
     and mining_row.claimed_at is null
   order by mining_row.started_at desc
   limit 1
   for update;

  if not found then raise exception 'No active mining session'; end if;
  if now() < v_session.ends_at then raise exception 'Mining is not finished yet'; end if;

  v_reward := round(v_session.rate_per_hour * v_session.duration_hours, 8);

  update public.easygram_mining_sessions as mining_row
     set claimed_at = now(), reward_gram = v_reward
   where mining_row.id = v_session.id
     and mining_row.claimed_at is null
  returning mining_row.id into v_claimed_id;
  if v_claimed_id is null then raise exception 'Mining reward was already claimed'; end if;

  update public.easygram_users as user_row
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

-- 4) Confirm one ad session. Only withdrawal ads increment the withdrawal counter.
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer);
drop function if exists public.easygram_confirm_ad_session(uuid,text,text,integer,boolean);

create function public.easygram_confirm_ad_session(
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

  select ad_row.*
    into v_session
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
      select user_row.withdrawal_ads_watched
        into v_count
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

-- 5) Start/claim mining only when the matching confirmed ad session exists.
drop function if exists public.easygram_start_mining_with_ad(text,numeric,numeric,uuid);
drop function if exists public.easygram_claim_mining_with_ad(text,uuid);

create function public.easygram_start_mining_with_ad(
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
  v_session public.easygram_mining_sessions%rowtype;
begin
  perform 1
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
   for update;
  if not found then raise exception 'User not found or suspended'; end if;

  if exists (
    select 1 from public.easygram_mining_sessions as mining_row
     where mining_row.telegram_id = p_telegram_id
       and mining_row.claimed_at is null
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

  update public.easygram_ad_sessions as ad_row
     set used_at = now()
   where ad_row.id = p_ad_session_id
     and ad_row.used_at is null;

  select mining_result.* into v_session
    from public.easygram_start_mining(p_telegram_id, p_rate_per_hour, p_duration_hours) as mining_result;
  return next v_session;
end;
$$;

create function public.easygram_claim_mining_with_ad(
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
  perform 1
    from public.easygram_users as user_row
   where user_row.telegram_id = p_telegram_id
     and coalesce(user_row.is_banned, false) = false
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

  update public.easygram_ad_sessions as ad_row
     set used_at = now()
   where ad_row.id = p_ad_session_id
     and ad_row.used_at is null;

  return query
    select claim_result.reward_gram, claim_result.balance_gram,
           claim_result.started_at, claim_result.ends_at
      from public.easygram_claim_mining(p_telegram_id) as claim_result;
end;
$$;

-- 6) Repeatable ad task: once each six hours. Other task limits remain intact.
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

  select user_row.* into v_user
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

-- 7) Permissions: only the server's service_role may execute reward functions.
revoke all on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) from public, anon, authenticated;
revoke all on function public.easygram_start_mining(text,numeric,numeric) from public, anon, authenticated;
revoke all on function public.easygram_claim_mining(text) from public, anon, authenticated;
revoke all on function public.easygram_start_mining_with_ad(text,numeric,numeric,uuid) from public, anon, authenticated;
revoke all on function public.easygram_claim_mining_with_ad(text,uuid) from public, anon, authenticated;
revoke all on function public.easygram_complete_task(text,bigint,uuid,uuid) from public, anon, authenticated;

grant execute on function public.easygram_confirm_ad_session(uuid,text,text,integer,boolean) to service_role;
grant execute on function public.easygram_start_mining(text,numeric,numeric) to service_role;
grant execute on function public.easygram_claim_mining(text) to service_role;
grant execute on function public.easygram_start_mining_with_ad(text,numeric,numeric,uuid) to service_role;
grant execute on function public.easygram_claim_mining_with_ad(text,uuid) to service_role;
grant execute on function public.easygram_complete_task(text,bigint,uuid,uuid) to service_role;

notify pgrst, 'reload schema';

-- 8) Verification results. Expected: all five functions listed; active ad task(s) may vary.
select p.proname as function_name, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'easygram_confirm_ad_session',
    'easygram_start_mining_with_ad',
    'easygram_claim_mining_with_ad',
    'easygram_start_mining',
    'easygram_claim_mining',
    'easygram_complete_task'
  )
order by p.proname;

select id, title, kind, is_active
from public.easygram_tasks
where kind = 'ad'
order by sort_order, id;
-- 9) Latest task behavior: configurable ad batches and per-task cooldowns.
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
