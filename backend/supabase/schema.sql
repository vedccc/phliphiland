-- Phillip Island Host — consolidated Supabase schema
-- Generated from migrations/ in order. Run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run) on project ictumlksmzjenevtaqvp.

-- ======================================================================
-- migrations/20260529000000_baseline.sql
-- ======================================================================
-- Baseline schema for Iris de Mer.
-- Mirrors the current Uncommon Supabase schema, with Turno columns removed.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  can_view_kb boolean not null default false,
  can_view_maintenance boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_authenticated_read" on public.profiles
  for select to authenticated using (true);
create policy "profiles_self_update" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  guesty_listing_id text not null unique,
  is_active boolean not null default true,
  timezone text default 'America/New_York',
  created_at timestamptz not null default now()
);
alter table public.properties enable row level security;
create policy "properties_authenticated_all" on public.properties
  for all to authenticated using (true) with check (true);

-- knowledge_bases
create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  content text not null,
  category text,
  video_url text,
  image_url text,
  created_at timestamptz not null default now()
);
create index on public.knowledge_bases (property_id);
alter table public.knowledge_bases enable row level security;
create policy "kb_authenticated_all" on public.knowledge_bases
  for all to authenticated using (true) with check (true);

-- kb_gap_log
create table public.kb_gap_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guest_question text not null,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.kb_gap_log (property_id, created_at desc);
alter table public.kb_gap_log enable row level security;
create policy "kb_gap_authenticated_all" on public.kb_gap_log
  for all to authenticated using (true) with check (true);

-- cooldowns
create table public.cooldowns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text,
  is_active boolean not null default true,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.cooldowns (property_id, is_active);
alter table public.cooldowns enable row level security;
create policy "cooldowns_authenticated_all" on public.cooldowns
  for all to authenticated using (true) with check (true);

-- urgency_categories
create table public.urgency_categories (
  id uuid primary key default gen_random_uuid(),
  level text not null unique,
  description text,
  examples text,
  response_time text,
  created_at timestamptz not null default now()
);
alter table public.urgency_categories enable row level security;
create policy "urgency_authenticated_all" on public.urgency_categories
  for all to authenticated using (true) with check (true);
insert into public.urgency_categories (level, description, examples, response_time) values
  ('high',    'Significant issue affecting guest stay',           '',  'within 1 hour'),
  ('medium',  'Moderate issue, attention needed soon',            '',  'within 4 hours'),
  ('low',     'Minor issue, can wait',                            '',  'within 24 hours');

-- maintenance_tickets
create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  description text not null,
  urgency text not null,
  status text not null default 'open',
  guest_context text,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.maintenance_tickets (property_id, status);
alter table public.maintenance_tickets enable row level security;
create policy "tickets_authenticated_all" on public.maintenance_tickets
  for all to authenticated using (true) with check (true);

-- allowed_extras
create table public.allowed_extras (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.allowed_extras enable row level security;
create policy "extras_authenticated_all" on public.allowed_extras
  for all to authenticated using (true) with check (true);

-- extra_requests
create table public.extra_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_uuid text,
  item_requested text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index on public.extra_requests (property_id, status);
alter table public.extra_requests enable row level security;
create policy "extra_requests_authenticated_all" on public.extra_requests
  for all to authenticated using (true) with check (true);

-- sms_recipients
create table public.sms_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  receives_maintenance_low boolean not null default false,
  receives_maintenance_medium boolean not null default false,
  receives_maintenance_high boolean not null default false,
  receives_kb_gaps boolean not null default false,
  receives_checkin_checkout boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sms_recipients enable row level security;
create policy "sms_recipients_authenticated_all" on public.sms_recipients
  for all to authenticated using (true) with check (true);

-- agent_activity_log
create table public.agent_activity_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  reservation_uuid text,
  action_type text not null,
  created_at timestamptz not null default now()
);
create index on public.agent_activity_log (property_id, created_at desc);
alter table public.agent_activity_log enable row level security;
create policy "agent_log_authenticated_all" on public.agent_activity_log
  for all to authenticated using (true) with check (true);

-- Auto-populate profiles on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ======================================================================
-- migrations/20260529000100_checklist.sql
-- ======================================================================
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null default 'Cleaning Checklist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)
);
alter table public.checklist_templates enable row level security;
create policy "checklist_templates_authenticated_all" on public.checklist_templates
  for all to authenticated using (true) with check (true);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  body text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.checklist_template_items (template_id, sort_order);
alter table public.checklist_template_items enable row level security;
create policy "checklist_template_items_authenticated_all" on public.checklist_template_items
  for all to authenticated using (true) with check (true);

create table public.checklist_instances (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_uuid text not null,
  template_id uuid references public.checklist_templates(id) on delete set null,
  status text not null default 'pending',
  link_token text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.checklist_instances (property_id, created_at desc);
create index on public.checklist_instances (reservation_uuid);
alter table public.checklist_instances enable row level security;
create policy "checklist_instances_authenticated_all" on public.checklist_instances
  for all to authenticated using (true) with check (true);

create table public.checklist_instance_items (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.checklist_instances(id) on delete cascade,
  body text not null,
  sort_order integer not null,
  is_checked boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.checklist_instance_items (instance_id, sort_order);
alter table public.checklist_instance_items enable row level security;
create policy "checklist_instance_items_authenticated_all" on public.checklist_instance_items
  for all to authenticated using (true) with check (true);

-- ======================================================================
-- migrations/20260529000200_reservations.sql
-- ======================================================================
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guesty_reservation_id text not null unique,
  guest_name text,
  guest_email text,
  guest_phone text,
  platform text,
  check_in date,
  check_out date,
  status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.reservations (property_id, check_in desc);
alter table public.reservations enable row level security;
create policy "reservations_authenticated_all" on public.reservations
  for all to authenticated using (true) with check (true);

-- ======================================================================
-- migrations/20260529000300_sms_extras.sql
-- ======================================================================
create table public.extras_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  extra_request_id uuid not null references public.extra_requests(id) on delete cascade,
  token text not null unique,
  recipient_phone text not null,
  status text not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.extras_approval_tokens (extra_request_id);
alter table public.extras_approval_tokens enable row level security;
create policy "extras_tokens_authenticated_all" on public.extras_approval_tokens
  for all to authenticated using (true) with check (true);

alter table public.extra_requests
  add column if not exists approval_status text default 'pending',
  add column if not exists approved_by_phone text;

-- ======================================================================
-- migrations/20260529000400_sms_recipients_routing.sql
-- ======================================================================
alter table public.sms_recipients
  add column if not exists receives_extras boolean not null default false,
  add column if not exists receives_reservation_checklist boolean not null default false;

-- ======================================================================
-- migrations/20260529000500_harden_handle_new_user.sql
-- ======================================================================
-- Address security advisor findings on handle_new_user:
--   1) function_search_path_mutable - pin search_path
--   2) security_definer_function_executable - revoke public execute (trigger-only)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- ======================================================================
-- migrations/20260602000000_profiles_can_view_reservations.sql
-- ======================================================================
alter table public.profiles
  add column if not exists can_view_reservations boolean not null default false;

-- Backfill: existing super_admins already see everything, so flip them on.
update public.profiles
set can_view_reservations = true
where role = 'super_admin';

-- ======================================================================
-- migrations/20260602000100_checklist_attribution_and_delivery_time.sql
-- ======================================================================
-- Track WHO completed each checklist item (transcript: "log who completed this")
alter table public.checklist_instance_items
  add column if not exists checked_by_user_id uuid references public.profiles(id) on delete set null;

-- For the extras approval flow: when a host accepts, they pick a delivery time
-- which gets relayed back to the guest by the agent (transcript: "time and date chooser")
alter table public.extras_approval_tokens
  add column if not exists delivery_at timestamptz;

alter table public.extra_requests
  add column if not exists delivery_at timestamptz;

-- ======================================================================
-- migrations/20260622000000_guesty_extra_request_conversation.sql
-- ======================================================================
-- Persist the Guesty conversation + channel on extra_requests so the host-approval
-- re-fire (extras-respond) can reply to the guest on the right conversation/channel.
alter table public.extra_requests
  add column if not exists guesty_conversation_id text,
  add column if not exists guesty_channel_module text;
