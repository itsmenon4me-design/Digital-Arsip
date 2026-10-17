-- Rekonstruksi dari fungsi/trigger yang tersisa di riwayat SQL proyek.
-- Skema ini adalah rancangan lama dan tidak digunakan oleh website saat ini.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, anon;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create or replace function private.current_profile_unit()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.unit_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create or replace function private.can_read_arsip(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.arsip as archive
    join public.profiles as profile on profile.id = (select auth.uid())
    where archive.id = target_id
      and (
        profile.role = 'admin'
        or (profile.role = 'petugas' and profile.unit_id = archive.unit_id)
        or (
          profile.role = 'viewer'
          and archive.status = 'terverifikasi'
          and archive.tingkat_akses in ('publik', 'internal')
        )
      )
  )
$$;

create or replace function private.can_manage_arsip(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.arsip as archive
    join public.profiles as profile on profile.id = (select auth.uid())
    where archive.id = target_id
      and (
        profile.role = 'admin'
        or (
          profile.role = 'petugas'
          and profile.unit_id = archive.unit_id
          and archive.dibuat_oleh = (select auth.uid())
          and archive.status in ('menunggu', 'ditolak')
        )
      )
  )
$$;

create or replace function private.can_upload_arsip_file(
  target_id uuid,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.arsip as archive
    where archive.id = target_id
      and archive.file_path = object_name
      and private.can_manage_arsip(archive.id)
  )
$$;

create or replace function private.can_upload_arsip_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  archive_folder text;
begin
  archive_folder := split_part(object_name, '/', 2);
  if split_part(object_name, '/', 1) !~ '^[0-9]{4}$'
    or archive_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(object_name, '/', 3) = '' then
    return false;
  end if;

  return private.can_upload_arsip_file(archive_folder::uuid, object_name);
end;
$$;

create or replace function private.can_manage_arsip_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  archive_folder text;
begin
  archive_folder := split_part(object_name, '/', 2);
  if archive_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return private.can_manage_arsip(archive_folder::uuid);
end;
$$;

revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.current_profile_unit() from public, anon;
revoke all on function private.can_read_arsip(uuid) from public, anon;
revoke all on function private.can_manage_arsip(uuid) from public, anon;
revoke all on function private.can_upload_arsip_file(uuid, text) from public, anon;
revoke all on function private.can_upload_arsip_object(text) from public, anon;
revoke all on function private.can_manage_arsip_object(text) from public, anon;
grant execute on function private.current_profile_role() to authenticated, anon;
grant execute on function private.current_profile_unit() to authenticated, anon;
grant execute on function private.can_read_arsip(uuid) to authenticated, anon;
grant execute on function private.can_manage_arsip(uuid) to authenticated, anon;
grant execute on function private.can_upload_arsip_file(uuid, text) to authenticated, anon;
grant execute on function private.can_upload_arsip_object(text) to authenticated, anon;
grant execute on function private.can_manage_arsip_object(text) to authenticated, anon;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nama, role)
  values (
    new.id,
    nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'nama', '')), ''),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, nama, role)
select
  auth_user.id,
  nullif(pg_catalog.btrim(coalesce(auth_user.raw_user_meta_data ->> 'nama', '')), ''),
  'viewer'
from auth.users as auth_user
on conflict (id) do nothing;

create or replace function public.set_arsip_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_arsip_updated_at() from public, anon, authenticated;

drop trigger if exists set_arsip_updated_at on public.arsip;
create trigger set_arsip_updated_at
  before update on public.arsip
  for each row execute function public.set_arsip_updated_at();

create or replace function public.audit_arsip_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  affected public.arsip%rowtype;
  action_name text;
  linked_arsip_id uuid;
begin
  if tg_op = 'DELETE' then
    affected := old;
    action_name := 'hapus';
    linked_arsip_id := null;
  elsif tg_op = 'INSERT' then
    affected := new;
    action_name := 'buat';
    linked_arsip_id := new.id;
  else
    affected := new;
    action_name := 'ubah';
    linked_arsip_id := new.id;
  end if;

  if actor_id is not null then
    insert into public.audit_log (user_id, aksi, arsip_id, detail)
    values (
      actor_id,
      action_name,
      linked_arsip_id,
      pg_catalog.jsonb_build_object(
        'arsip_id', affected.id,
        'nomor_arsip', affected.nomor_arsip,
        'judul', affected.judul
      )
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_arsip_write() from public, anon, authenticated;

drop trigger if exists audit_arsip_insert on public.arsip;
create trigger audit_arsip_insert
  after insert on public.arsip
  for each row execute function public.audit_arsip_write();

drop trigger if exists audit_arsip_update on public.arsip;
create trigger audit_arsip_update
  after update on public.arsip
  for each row execute function public.audit_arsip_write();

drop trigger if exists audit_arsip_delete on public.arsip;
create trigger audit_arsip_delete
  after delete on public.arsip
  for each row execute function public.audit_arsip_write();
