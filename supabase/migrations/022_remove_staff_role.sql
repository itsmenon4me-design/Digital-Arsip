begin;

-- PostgreSQL enum labels cannot be removed in place. The profile constraint
-- prevents assigning the legacy label until a coordinated enum rebuild is planned.
update public.profiles
set role = 'petugas_arsip'::public.profile_role
where role::text = 'staf';

alter table public.profiles
  alter column role set default 'petugas_arsip'::public.profile_role;

alter table public.profiles
  drop constraint if exists profiles_role_supported_check;

alter table public.profiles
  add constraint profiles_role_supported_check
  check (
    role in (
      'admin'::public.profile_role,
      'petugas_arsip'::public.profile_role
    )
  );

create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nama_lengkap, role)
  values (
    new.id,
    nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'nama_lengkap', '')), ''),
    'petugas_arsip'::public.profile_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.record_archive_access(
  p_archive_id uuid,
  p_action public.log_audit_aksi
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := coalesce(private.current_profile_role()::text, '');
  archive_row public.arsip%rowtype;
begin
  if actor_id is null
    or actor_role not in ('admin', 'petugas_arsip')
    or p_action is null
    or p_action not in ('buka', 'unduh') then
    return false;
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_archive_id
    and archive.deleted_at is null
    and (
      archive.tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
      or actor_role in ('admin', 'petugas_arsip')
    )
  for share;

  if not found or archive_row.file_status <> 'tersedia' then
    return false;
  end if;

  if not exists (
    select 1
    from storage.objects as object_row
    where object_row.bucket_id = 'arsip'
      and object_row.name = archive_row.file_path
  ) then
    return false;
  end if;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    p_action,
    p_archive_id,
    pg_catalog.jsonb_build_object(
      'nomor_arsip', archive_row.nomor_arsip,
      'judul', archive_row.judul
    )
  );

  return true;
end;
$$;

commit;
