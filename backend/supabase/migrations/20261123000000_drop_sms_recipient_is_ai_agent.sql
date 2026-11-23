-- The "AI agent number" idea was a misunderstanding: any recipient can simply
-- have a schedule (sms_recipients.schedule, null = any time). The flag is unused.
alter table public.sms_recipients drop column if exists is_ai_agent;
