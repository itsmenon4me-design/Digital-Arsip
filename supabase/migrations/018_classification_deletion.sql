begin;

-- Jalankan setelah 017_classification_management.sql.
create or replace function public.admin_list_classification_usage()
returns table (id uuid, dipakai boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;

  return query
  select
    classification.id,
    exists (
      select 1
      from public.arsip as archive
      where archive.klasifikasi_id = classification.id
    ) as dipakai
  from public.klasifikasi as classification
  order by classification.kode;
end;
$$;

create or replace function public.admin_delete_classification(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Pilih klasifikasi yang akan dihapus.' using errcode = '22023';
  end if;

  select classification.*
    into classification_row
  from public.klasifikasi as classification
  where classification.id = p_id
  for update;

  if not found then
    raise exception 'Klasifikasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.arsip as archive
    where archive.klasifikasi_id = classification_row.id
  ) then
    raise exception 'Klasifikasi masih dipakai oleh arsip.'
      using errcode = '23503';
  end if;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    'ubah',
    null,
    pg_catalog.jsonb_build_object(
      'entitas', 'klasifikasi',
      'operasi', 'hapus',
      'klasifikasi_id', classification_row.id,
      'kode', classification_row.kode,
      'nama', classification_row.nama
    )
  );

  delete from public.klasifikasi as classification
  where classification.id = classification_row.id;

  return pg_catalog.jsonb_build_object(
    'id', classification_row.id,
    'kode', classification_row.kode,
    'nama', classification_row.nama
  );
end;
$$;

revoke all on function public.admin_list_classification_usage()
  from public, anon, authenticated;
grant execute on function public.admin_list_classification_usage()
  to authenticated;

revoke all on function public.admin_delete_classification(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_classification(uuid)
  to authenticated;

commit;
