-- Air Freight received goods (minimum schema for Admin MVP + user read-only list)
-- Run in Supabase SQL editor if public.air_freight_goods does not already exist.

create table if not exists public.air_freight_goods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  km_id text not null,
  date_received date not null default (current_date),
  goods_description text not null,
  supplier_phone text,
  tracking_number text,
  quantity numeric,
  weight_kg numeric,
  photo_url text,
  admin_remarks text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists air_freight_goods_user_id_idx
  on public.air_freight_goods (user_id);

create index if not exists air_freight_goods_km_id_idx
  on public.air_freight_goods (km_id);

alter table public.air_freight_goods enable row level security;

-- Users: read only their own received goods
drop policy if exists "air_freight_goods_select_own" on public.air_freight_goods;
create policy "air_freight_goods_select_own"
  on public.air_freight_goods
  for select
  to authenticated
  using (user_id = auth.uid());

-- Admins: full access for receive-goods MVP
drop policy if exists "air_freight_goods_admin_all" on public.air_freight_goods;
create policy "air_freight_goods_admin_all"
  on public.air_freight_goods
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

-- Optional: allow admins to look up profiles by km_id if not already permitted.
-- Only create if admin KM verification fails with a permissions error.
-- drop policy if exists "profiles_admin_select" on public.profiles;
-- create policy "profiles_admin_select"
--   on public.profiles
--   for select
--   to authenticated
--   using (
--     user_id = auth.uid()
--     or exists (
--       select 1 from public.profiles p
--       where p.user_id = auth.uid() and p.role = 'admin'
--     )
--   );
