-- Active hours (Agent Config): the AI replies only inside a weekly schedule,
-- in Melbourne time. Off by default, so the AI keeps replying around the clock
-- until an admin turns it on. Read by guesty-webhook (_shared/schedule.ts).
-- Idempotent.

alter table public.agent_settings
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists schedule jsonb not null default '{
    "mon": {"on": true,  "start": "09:00", "end": "17:00"},
    "tue": {"on": true,  "start": "09:00", "end": "17:00"},
    "wed": {"on": true,  "start": "09:00", "end": "17:00"},
    "thu": {"on": true,  "start": "09:00", "end": "17:00"},
    "fri": {"on": true,  "start": "09:00", "end": "17:00"},
    "sat": {"on": false, "start": "09:00", "end": "17:00"},
    "sun": {"on": false, "start": "09:00", "end": "17:00"}
  }'::jsonb;

-- Same rule as test_mode: the super-admin update policy on agent_settings applies.
grant update (schedule_enabled, schedule) on public.agent_settings to authenticated;
