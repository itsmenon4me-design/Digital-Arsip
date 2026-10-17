-- 009: akses baca profiles & klasifikasi untuk user login
alter table public.klasifikasi enable row level security;
grant select on table public.klasifikasi to authenticated;
drop policy if exists klasifikasi_read_authenticated on public.klasifikasi;
create policy klasifikasi_read_authenticated
  on public.klasifikasi for select to authenticated
  using (true);

alter table public.profiles enable row level security;
grant select on table public.profiles to authenticated;
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- Rollback:
-- alter table public.klasifikasi disable row level security;
-- alter table public.profiles disable row level security;