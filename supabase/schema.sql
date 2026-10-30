-- TV & Movie Tracker: the tables behind sign-in and sync.
-- Run once in the Supabase SQL editor (or as a migration). Safe to share a
-- project with other apps: every name is prefixed tvt_ and every row is
-- locked to its owner by row-level security.

-- One row per title per user. The title itself is the app's item object in
-- `data` (jsonb), so adding fields in the app needs no migration. Deleted
-- titles stay as tombstones (deleted = true) so other devices learn of it.
create table if not exists public.tvt_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- One row per user: settings that follow you between devices.
create table if not exists public.tvt_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  tmdb_key text,
  updated_at timestamptz not null default now()
);

alter table public.tvt_items enable row level security;
alter table public.tvt_profiles enable row level security;

create policy "tvt_items: owner only" on public.tvt_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "tvt_profiles: owner only" on public.tvt_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Signed-in users can read and write rows (still filtered by the policies
-- above); anonymous visitors get nothing.
revoke all on public.tvt_items, public.tvt_profiles from anon, authenticated;
grant select, insert, update, delete on public.tvt_items, public.tvt_profiles to authenticated;
