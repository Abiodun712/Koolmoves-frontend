-- KoolMovez Logistics — add "shipped" to shipments.status CHECK
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, air_freight_goods.sql, or the full shipments.sql.
--
-- What this changes:
-- Replaces shipments_status_by_freight_check so "shipped" is allowed.
-- Air still cannot use in_transit.
-- Sea can still use in_transit.
-- No tables or columns added.
-- Idempotent.

alter table public.shipments
  drop constraint if exists shipments_status_by_freight_check;

alter table public.shipments
  add constraint shipments_status_by_freight_check
  check (
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
  );
