-- Easy Gram notifications migration
-- Run once in Supabase SQL Editor. Safe to rerun.

alter table public.easygram_users
  add column if not exists is_banned boolean not null default false,
  add column if not exists bot_blocked boolean not null default false,
  add column if not exists notify_last_reminder_at timestamptz,
  add column if not exists notify_reminder_count integer not null default 0;

create index if not exists easygram_users_notification_due_idx
  on public.easygram_users (last_seen_at, notify_last_reminder_at)
  where is_banned = false and bot_blocked = false;
