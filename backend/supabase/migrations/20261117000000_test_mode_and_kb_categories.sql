-- Test mode switch (Agent Config) + KB-gap routing by category (SMS Recipients).
-- Idempotent so it can be applied out of band and re-run safely.

-- ── Test mode ────────────────────────────────────────────────────────
-- One row. test_mode = true → the AI replies only to test_conversation_ids
-- (Matt's GY-VZ8WCHB3 and our GY-WbGZxkrE). Read by the guesty-webhook.
create table if not exists public.agent_settings (
  id boolean primary key default true check (id),
  test_mode boolean not null default true,
  test_conversation_ids text[] not null
    default array['6ab4e0843e05570011c490d7', '6a27b3f6ad3d6b00126f9b05'],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.agent_settings (id) values (true) on conflict (id) do nothing;

alter table public.agent_settings enable row level security;

drop policy if exists "agent_settings_authenticated_read" on public.agent_settings;
create policy "agent_settings_authenticated_read" on public.agent_settings
  for select to authenticated using (true);

-- Only super admins may flip the switch. No insert/delete for anyone but the service role.
drop policy if exists "agent_settings_super_admin_update" on public.agent_settings;
create policy "agent_settings_super_admin_update" on public.agent_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

-- The test conversations are fixed: only test_mode may change from the dashboard.
revoke update on public.agent_settings from authenticated;
grant update (test_mode, updated_at, updated_by) on public.agent_settings to authenticated;

-- ── KB-gap categories ────────────────────────────────────────────────
-- receives_kb_gaps keeps its meaning and is shown as "All".
alter table public.sms_recipients
  add column if not exists receives_kb_general boolean not null default false,
  add column if not exists receives_kb_cleaning boolean not null default false,
  add column if not exists receives_kb_maintenance boolean not null default false;

alter table public.kb_gap_log
  add column if not exists category text
    check (category in ('general', 'cleaning', 'maintenance'));
