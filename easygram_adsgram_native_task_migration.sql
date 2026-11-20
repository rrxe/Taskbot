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
