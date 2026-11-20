-- EASY GRAM: allow withdrawal rewarded ads to be counted by viewing only.
-- Run once in Supabase SQL Editor when upgrading an existing deployment.
-- Users must watch the AdsGram INT ad for at least 5 seconds; advertiser clicks
-- and opening external links are not required. Existing balances and counters
-- are preserved.

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

  -- A retried confirmation does not add a second withdrawal-ad credit.
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

-- Refresh PostgREST so the updated RPC definition is available immediately.
notify pgrst, 'reload schema';
