begin;

alter table public.klasifikasi
  add column if not exists keterangan text;

create or replace function public.admin_update_classification_description(
  p_id uuid,
  p_keterangan text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
  clean_description text := nullif(pg_catalog.btrim(coalesce(p_keterangan, '')), '');
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_id is null or pg_catalog.length(coalesce(clean_description, '')) > 2000 then
    raise exception 'Keterangan maksimal 2000 karakter.' using errcode = '22023';
  end if;

  select classification.*
    into classification_row
  from public.klasifikasi as classification
  where classification.id = p_id
  for update;

  if not found then
    raise exception 'Klasifikasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  if classification_row.keterangan is distinct from clean_description then
    update public.klasifikasi as classification
    set keterangan = clean_description
    where classification.id = p_id
    returning classification.* into classification_row;

    insert into public.log_audit (user_id, aksi, arsip_id, detail)
    values (
      actor_id,
      'ubah',
      null,
      pg_catalog.jsonb_build_object(
        'entitas', 'klasifikasi',
        'klasifikasi_id', classification_row.id,
        'kode', classification_row.kode,
        'nama', classification_row.nama,
        'keterangan', classification_row.keterangan
      )
    );
  end if;

  return pg_catalog.to_jsonb(classification_row);
end;
$$;

revoke all on function public.admin_update_classification_description(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_classification_description(uuid, text)
  to authenticated;

commit;
