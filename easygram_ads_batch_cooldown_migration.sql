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
