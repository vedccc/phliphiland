alter table public.profiles
  add column if not exists can_view_reservations boolean not null default false;

-- Backfill: existing super_admins already see everything, so flip them on.
update public.profiles
set can_view_reservations = true
where role = 'super_admin';
