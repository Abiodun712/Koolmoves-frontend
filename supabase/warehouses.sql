-- KoolMovez Logistics MVP foundation (Air only)
-- Apply manually in Supabase after public.air_freight_goods exists
-- (see supabase/air_freight_goods.sql). Do NOT run from the app.
--
-- Approved architecture:
-- - Keep public.air_freight_goods as the Air goods table (do NOT replace with logistics_goods).
-- - Sea will later use a parallel public.sea_freight_goods table (not created here).
-- - Shared: public.warehouses + public.packing_requests.
-- - Air packing items: public.air_packing_request_items -> air_freight_goods.
-- - Freight type is determined by China receiving warehouse (CN-AIR -> air, CN-SEA -> sea).
-- - Nigeria pickup warehouses support air, sea, or both; packing_requests require a pickup.

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text not null check (country in ('china', 'nigeria')),
  kind text not null check (kind in ('receiving', 'pickup')),
  freight_type text not null check (freight_type in ('air', 'sea', 'both')),
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint warehouses_china_receiving_single_freight check (
    not (country = 'china' and kind = 'receiving' and freight_type = 'both')
  ),
  constraint warehouses_china_is_receiving check (
    country <> 'china' or kind = 'receiving'
  ),
  constraint warehouses_nigeria_is_pickup check (
    country <> 'nigeria' or kind = 'pickup'
  )
);

create index if not exists warehouses_active_idx
  on public.warehouses (country, kind, is_active);

alter table public.warehouses enable row level security;

drop policy if exists "warehouses_select_authenticated" on public.warehouses;
create policy "warehouses_select_authenticated"
  on public.warehouses
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "warehouses_admin_all" on public.warehouses;
create policy "warehouses_admin_all"
  on public.warehouses
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- Seed ONLY approved warehouses (7 columns per row).
-- Idempotent: single ON CONFLICT (code) DO UPDATE
-- Each row: code, name, country, kind, freight_type, address, is_active
insert into public.warehouses (code, name, country, kind, freight_type, address, is_active)
values
  (
    'CN-AIR',
    'Air China Warehouse',
    'china',
    'receiving',
    'air',
    E'广东省广州市越秀区 三元里大道，伍福服装城 C1-087\nPhone: 17620727605',
    true
  ),
  (
    'CN-SEA',
    'Sea China Warehouse',
    'china',
    'receiving',
    'sea',
    E'导航：佛山市里水镇莲塘大道2号岭城仓储物流园107卡\nPhone: 17620727605',
    true
  ),
  (
    'NG-IKEJA',
    'Ikeja',
    'nigeria',
    'pickup',
    'both',
    E'47, Kalejaye Street, Bisam Bus/stop. Ikeja, Lagos State. Nigeria.\nPhone: +234 916 795 6122',
    true
  ),
  (
    'NG-IYANA-IPAJA',
    'Iyana Ipaja',
    'nigeria',
    'pickup',
    'both',
    E'No. 11, New Ipaja Road,\nBeside Ideraoluwa Central Mosque,\nAlong Itel Home Road.\nIyana Ipaja.\nLagos State. Nigeria\nPhone: +234 803 846 8441',
    true
  )
on conflict (code) do update set
  name = excluded.name,
  country = excluded.country,
  kind = excluded.kind,
  freight_type = excluded.freight_type,
  address = excluded.address,
  is_active = excluded.is_active;

-- Air goods stay on air_freight_goods; link to China receiving warehouse (freight via warehouse).
alter table public.air_freight_goods
  add column if not exists china_warehouse_id uuid references public.warehouses (id);

create index if not exists air_freight_goods_china_warehouse_id_idx
  on public.air_freight_goods (china_warehouse_id);

-- Backfill existing air goods to Air China Warehouse when missing
update public.air_freight_goods g
set china_warehouse_id = w.id
from public.warehouses w
where g.china_warehouse_id is null
  and w.code = 'CN-AIR';

-- Shared packing/shipping request header (Air now; Sea later).
-- nigeria_pickup_warehouse_id is required.
create table if not exists public.packing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  km_id text not null,
  freight_type text not null check (freight_type in ('air', 'sea')),
  china_warehouse_id uuid references public.warehouses (id),
  nigeria_pickup_warehouse_id uuid not null references public.warehouses (id),
  status text not null default 'pending_packing',
  created_at timestamptz not null default now()
);

create index if not exists packing_requests_user_id_idx
  on public.packing_requests (user_id);

-- Air-only packing items for MVP. Sea will add parallel sea_packing_request_items later.
create table if not exists public.air_packing_request_items (
  request_id uuid not null references public.packing_requests (id) on delete cascade,
  goods_id uuid not null references public.air_freight_goods (id),
  primary key (request_id, goods_id)
);

alter table public.packing_requests enable row level security;
alter table public.air_packing_request_items enable row level security;

drop policy if exists "packing_requests_select_own" on public.packing_requests;
create policy "packing_requests_select_own"
  on public.packing_requests
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "packing_requests_insert_own" on public.packing_requests;
create policy "packing_requests_insert_own"
  on public.packing_requests
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Compensating delete: user may remove their own pending header only if it has no goods.
-- Used when packing_requests INSERT succeeds but air_packing_request_items INSERT fails.
drop policy if exists "packing_requests_delete_own_empty_pending" on public.packing_requests;
create policy "packing_requests_delete_own_empty_pending"
  on public.packing_requests
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and status = 'pending_packing'
    and not exists (
      select 1 from public.air_packing_request_items i
      where i.request_id = packing_requests.id
    )
  );

drop policy if exists "packing_requests_admin_all" on public.packing_requests;
create policy "packing_requests_admin_all"
  on public.packing_requests
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "air_packing_request_items_select_own" on public.air_packing_request_items;
create policy "air_packing_request_items_select_own"
  on public.air_packing_request_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.packing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "air_packing_request_items_insert_own" on public.air_packing_request_items;
create policy "air_packing_request_items_insert_own"
  on public.air_packing_request_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.packing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "air_packing_request_items_admin_all" on public.air_packing_request_items;
create policy "air_packing_request_items_admin_all"
  on public.air_packing_request_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- If an older draft created packing_request_items, leave it unused; Air MVP uses air_packing_request_items.
