-- Track WHO completed each checklist item (transcript: "log who completed this")
alter table public.checklist_instance_items
  add column if not exists checked_by_user_id uuid references public.profiles(id) on delete set null;

-- For the extras approval flow: when a host accepts, they pick a delivery time
-- which gets relayed back to the guest by the agent (transcript: "time and date chooser")
alter table public.extras_approval_tokens
  add column if not exists delivery_at timestamptz;

alter table public.extra_requests
  add column if not exists delivery_at timestamptz;
