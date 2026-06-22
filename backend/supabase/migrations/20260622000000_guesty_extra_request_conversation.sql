-- Persist the Guesty conversation + channel on extra_requests so the host-approval
-- re-fire (extras-respond) can reply to the guest on the right conversation/channel.
alter table public.extra_requests
  add column if not exists guesty_conversation_id text,
  add column if not exists guesty_channel_module text;
