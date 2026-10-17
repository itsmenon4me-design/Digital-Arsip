create or replace function public.admin_user_directory()
returns table (
  id uuid,
  nama_lengkap text,
  email text,
  role text,
  unit text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan'
      using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.nama_lengkap::text,
    auth_user.email::text,
    profile.role::text,
    profile.unit::text,
    case
      when auth_user.id is null then 'Akun Auth tidak ditemukan'
      when (pg_catalog.to_jsonb(auth_user) ->> 'deleted_at') is not null then 'Dihapus'
      when nullif(pg_catalog.to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz > pg_catalog.now()
        then 'Ditangguhkan'
      when pg_catalog.to_jsonb(auth_user) ->> 'email_confirmed_at' is null
        then 'Belum dikonfirmasi'
      else 'Aktif'
    end,
    profile.created_at
  from public.profiles as profile
  left join auth.users as auth_user on auth_user.id = profile.id
  order by profile.created_at desc;
end;
$$;

revoke all on function public.admin_user_directory()
  from public, anon, authenticated;
grant execute on function public.admin_user_directory() to authenticated;

-- Rollback jika RPC perlu dibatalkan:
-- revoke all on function public.admin_user_directory()
--   from public, anon, authenticated;
-- drop function public.admin_user_directory();