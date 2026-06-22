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
