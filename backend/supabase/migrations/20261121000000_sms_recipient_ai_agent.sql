-- SMS Recipients → AI agent number: a recipient flagged as an AI agent gets a
-- copy of the texts it is ticked for, but only inside its weekly schedule
-- (Melbourne time). Outside it, its copy is skipped. schedule null = always
-- (every existing recipient). Enforced by onDuty() in trigger/helpers/schedule.ts
-- and supabase/functions/_shared/schedule.ts. Idempotent.

alter table public.sms_recipients
  add column if not exists is_ai_agent boolean not null default false,
  add column if not exists schedule jsonb;
