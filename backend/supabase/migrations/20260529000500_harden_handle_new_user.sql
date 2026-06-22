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
