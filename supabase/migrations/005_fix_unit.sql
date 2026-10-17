-- Menyesuaikan helper unit dengan profiles.unit (text); periksa definisi fungsi di pg_proc setelah dijalankan.
do $$
declare
  existing_function_oid oid;
  existing_return_type oid;
  dependent_policies text;
begin
  select procedure.oid, procedure.prorettype
    into existing_function_oid, existing_return_type
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname = 'current_profile_unit'
    and procedure.pronargs = 0;

  if existing_return_type = 'uuid'::regtype then
    select pg_catalog.string_agg(
      pg_catalog.format('%I.%I', relation.relname, policy.polname),
      ', '
    )
      into dependent_policies
    from pg_catalog.pg_depend as dependency
    join pg_catalog.pg_policy as policy
      on dependency.classid = 'pg_catalog.pg_policy'::regclass
      and policy.oid = dependency.objid
    join pg_catalog.pg_class as relation
      on relation.oid = policy.polrelid
    where dependency.refclassid = 'pg_catalog.pg_proc'::regclass
      and dependency.refobjid = existing_function_oid;

    if dependent_policies is not null then
      raise exception
        'private.current_profile_unit() masih bertipe uuid dan dipakai policy: %. Tinjau lalu ubah policy tersebut sebelum menjalankan ulang file ini; jangan gunakan CASCADE.',
        dependent_policies;
    end if;

    execute 'drop function private.current_profile_unit()';
  elsif existing_return_type is not null
    and existing_return_type <> 'text'::regtype then
    raise exception
      'private.current_profile_unit() memiliki tipe hasil yang tidak didukung; tinjau fungsi sebelum menjalankan perbaikan';
  end if;
end;
$$;

create or replace function private.current_profile_unit()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.unit
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

revoke all on function private.current_profile_unit() from public, anon;
grant execute on function private.current_profile_unit() to authenticated;
