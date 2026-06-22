alter table public.sms_recipients
  add column if not exists receives_extras boolean not null default false,
  add column if not exists receives_reservation_checklist boolean not null default false;
