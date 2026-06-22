-- Invoice / file attachments for maintenance tickets (transcript: "upload an
-- invoice to the maintenance tickets"). Files live in the public Storage bucket
-- `ticket-invoices`; this table records the public URLs per ticket.
create table if not exists public.ticket_files (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_files_ticket_id_idx on public.ticket_files (ticket_id);
alter table public.ticket_files enable row level security;
create policy "ticket_files_authenticated_all" on public.ticket_files
  for all to authenticated using (true) with check (true);

-- Public-read storage bucket for the uploaded invoice files.
insert into storage.buckets (id, name, public)
  values ('ticket-invoices', 'ticket-invoices', true)
  on conflict (id) do nothing;

-- Authenticated users (dashboard) may upload/manage objects in that bucket.
drop policy if exists "ticket_invoices_auth_insert" on storage.objects;
create policy "ticket_invoices_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'ticket-invoices');
drop policy if exists "ticket_invoices_auth_update" on storage.objects;
create policy "ticket_invoices_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'ticket-invoices');
drop policy if exists "ticket_invoices_auth_delete" on storage.objects;
create policy "ticket_invoices_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'ticket-invoices');
