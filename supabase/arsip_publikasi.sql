create extension if not exists pgcrypto;

create table if not exists public.arsip_publikasi (
  id uuid primary key default gen_random_uuid(),
  judul text not null,
  kategori text not null,
  tanggal_publikasi date,
  deskripsi text,
  file_url text,
  created_at timestamptz not null default now()
);

alter table public.arsip_publikasi enable row level security;

-- RLS is enabled intentionally without creating a permissive policy.
-- Define the auth model and table policies after the application access rules are agreed upon.
-- Until then, no anonymous or broad public access is allowed.
