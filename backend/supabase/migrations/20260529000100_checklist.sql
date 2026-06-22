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
