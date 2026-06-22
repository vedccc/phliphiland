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
