-- KoolMovez Logistics — Shipment & Costing Foundation
-- Apply manually in Supabase AFTER using packing instructions / shipment admin UI.
-- Requires: warehouses, packing_requests, air_freight_goods, air_packing_request_items
-- (see supabase/warehouses.sql and supabase/air_freight_goods.sql).
-- Do NOT run from the app.
--
-- Rules encoded here:
-- - Shared shipments table (Air now; Sea later via freight_type).
-- - Final packed weight is admin-entered (never auto-summed from goods).
-- - Packing fee + landing cost are shipment-level only (not per goods item).
-- - Total amount due = freight_charge + packing_fee + landing_cost
--   where freight_charge = final_packed_weight_kg * rate_per_kg (snapshot).
-- - User packing instructions live on packing_requests (separate from admin_shipment_remarks).

-- ---------------------------------------------------------------------------
-- Packing request: user packing instructions + optional shipment link
-- ---------------------------------------------------------------------------
alter table public.packing_requests
  add column if not exists user_packing_instructions text;

alter table public.packing_requests
  add column if not exists shipment_id uuid;

-- ---------------------------------------------------------------------------
-- Shipments (shared Air/Sea header)
-- ---------------------------------------------------------------------------
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_code text not null unique,
  freight_type text not null check (freight_type in ('air', 'sea')),
  -- Status set is shared; Air is forbidden from in_transit via table CHECK below.
  -- Existing DBs: apply supabase/shipments_status_model.sql (do not re-run this whole file).
  status text not null default 'draft',
  user_id uuid not null references auth.users (id),
  km_id text not null,
  packing_request_id uuid references public.packing_requests (id),
  china_warehouse_id uuid references public.warehouses (id),
  nigeria_pickup_warehouse_id uuid not null references public.warehouses (id),
  departure_date date,
  estimated_arrival date,
  -- Admin re-weigh after packing — NEVER auto-calculated from item weights
  final_packed_weight_kg numeric(12, 3),
  -- Shipment-level costs (entered once; do not duplicate per item)
  packing_fee numeric(14, 2) not null default 0,
  landing_cost numeric(14, 2) not null default 0,
  -- Rate snapshot used for freight charge (from published fee / admin override)
  rate_per_kg numeric(14, 2),
  freight_charge numeric(14, 2),
  total_amount_due numeric(14, 2),
  admin_shipment_remarks text,
  finalized_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_status_by_freight_check check (
    status in (
      'draft',
      'assigned',
      'packing',
      'packed',
      'finalized',
      'shipped',
      'in_transit',
      'arrived_nigeria',
      'ready_for_pickup',
      'completed',
      'cancelled'
    )
    and not (freight_type = 'air' and status = 'in_transit')
  )
);

create index if not exists shipments_user_id_idx on public.shipments (user_id);
create index if not exists shipments_km_id_idx on public.shipments (km_id);
create index if not exists shipments_status_idx on public.shipments (status);
create index if not exists shipments_packing_request_id_idx on public.shipments (packing_request_id);

-- FK from packing_requests.shipment_id (deferred until shipments exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'packing_requests_shipment_id_fkey'
  ) then
    alter table public.packing_requests
      add constraint packing_requests_shipment_id_fkey
      foreign key (shipment_id) references public.shipments (id);
  end if;
end $$;

-- Air goods assigned to a shipment (items keep their own recorded weight_kg on air_freight_goods)
create table if not exists public.air_shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  goods_id uuid not null references public.air_freight_goods (id),
  packing_request_id uuid references public.packing_requests (id),
  primary key (shipment_id, goods_id)
);

create index if not exists air_shipment_items_goods_id_idx
  on public.air_shipment_items (goods_id);

alter table public.shipments enable row level security;
alter table public.air_shipment_items enable row level security;

-- Users: read own shipments
drop policy if exists "shipments_select_own" on public.shipments;
create policy "shipments_select_own"
  on public.shipments
  for select
  to authenticated
  using (user_id = auth.uid());

-- Admin: full access
drop policy if exists "shipments_admin_all" on public.shipments;
create policy "shipments_admin_all"
  on public.shipments
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

drop policy if exists "air_shipment_items_select_own" on public.air_shipment_items;
create policy "air_shipment_items_select_own"
  on public.air_shipment_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.shipments s
      where s.id = shipment_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "air_shipment_items_admin_all" on public.air_shipment_items;
create policy "air_shipment_items_admin_all"
  on public.air_shipment_items
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
