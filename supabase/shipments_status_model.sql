-- KoolMovez Logistics — shipment status model
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, air_freight_goods.sql, or the full shipments.sql.
--
-- What this changes:
-- 1) Any Air row with status in_transit is moved to finalized (preserves the row;
--    current Air admin end-state). Expected: 0 rows — admin never writes in_transit.
-- 2) Drops the old status-only CHECK (which allowed Air + in_transit).
-- 3) Adds table-level CHECK shipments_status_by_freight_check:
--    - Allowed statuses unchanged (no new payment statuses).
--    - Air cannot use in_transit.
--    - Sea can use in_transit.
-- Idempotent: safe to run more than once.

update public.shipments
set
  status = 'finalized',
  updated_at = now()
where freight_type = 'air'
  and status = 'in_transit';

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'shipments'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'in_transit'
      and pg_get_constraintdef(c.oid) ~* 'status'
  loop
    execute format('alter table public.shipments drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.shipments
  drop constraint if exists shipments_status_check;

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
