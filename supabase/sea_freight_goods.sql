-- KoolMovez Logistics — Sea goods + Sea packing items
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, air_freight_goods.sql, shipments.sql,
-- or logistics_payments.sql.
--
-- Creates:
--   public.sea_freight_goods        (CBM measurement, not KG)
--   public.sea_packing_request_items
-- Extends packing_requests compensating-delete so empty Sea headers
-- can be removed the same way as Air, without weakening Air RLS.

create table if not exists public.sea_freight_goods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  km_id text not null,
  china_warehouse_id uuid references public.warehouses (id),
  date_received date not null default (current_date),
  goods_description text not null,
  supplier_phone text,
  tracking_number text,
  quantity numeric,
  cbm numeric,
  photo_url text,
  admin_remarks text,
  status text not null default 'available'
    check (status in ('available', 'requested')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists sea_freight_goods_user_id_idx
  on public.sea_freight_goods (user_id);

create index if not exists sea_freight_goods_km_id_idx
  on public.sea_freight_goods (km_id);

create index if not exists sea_freight_goods_china_warehouse_id_idx
  on public.sea_freight_goods (china_warehouse_id);

alter table public.sea_freight_goods enable row level security;

drop policy if exists "sea_freight_goods_select_own" on public.sea_freight_goods;
create policy "sea_freight_goods_select_own"
  on public.sea_freight_goods
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "sea_freight_goods_admin_all" on public.sea_freight_goods;
create policy "sea_freight_goods_admin_all"
  on public.sea_freight_goods
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

create table if not exists public.sea_packing_request_items (
  request_id uuid not null references public.packing_requests (id) on delete cascade,
  goods_id uuid not null references public.sea_freight_goods (id),
  primary key (request_id, goods_id)
);

alter table public.sea_packing_request_items enable row level security;

drop policy if exists "sea_packing_request_items_select_own" on public.sea_packing_request_items;
create policy "sea_packing_request_items_select_own"
  on public.sea_packing_request_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.packing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "sea_packing_request_items_insert_own" on public.sea_packing_request_items;
create policy "sea_packing_request_items_insert_own"
  on public.sea_packing_request_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.packing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "sea_packing_request_items_admin_all" on public.sea_packing_request_items;
create policy "sea_packing_request_items_admin_all"
  on public.sea_packing_request_items
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

-- Same compensating delete as Air: own pending header only if it has no goods.
-- Sea items are included so a Sea request with items cannot be deleted.
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
    and not exists (
      select 1 from public.sea_packing_request_items i
      where i.request_id = packing_requests.id
    )
  );
