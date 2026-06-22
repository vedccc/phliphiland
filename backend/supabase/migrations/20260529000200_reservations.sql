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
