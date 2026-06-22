-- The dashboard records when a ticket is marked resolved (and clears it when
-- reopened), but the baseline schema never created this column — so every status
-- change failed with PGRST204. Add it.
alter table public.maintenance_tickets
  add column if not exists resolved_at timestamptz;
