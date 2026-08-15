-- KoolMovez Logistics — Sea shipments (CBM costing + items + payment gate)
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run shipments.sql, warehouses.sql, logistics_payments.sql,
-- sea_freight_goods.sql, or shipments_air_complete_requires_confirmed_payment.sql.
--
-- Adds Sea packed-CBM snapshots and sea_shipment_items.
-- Extends logistics payment eligibility to Sea ready_for_pickup
-- WITHOUT changing the Air completion trigger.
-- Adds a separate Sea completion payment gate.

alter table public.shipments
  add column if not exists final_packed_cbm numeric(12, 3);

alter table public.shipments
  add column if not exists rate_per_cbm numeric(14, 2);

create table if not exists public.sea_shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  goods_id uuid not null references public.sea_freight_goods (id),
  packing_request_id uuid references public.packing_requests (id),
  primary key (shipment_id, goods_id)
);

create index if not exists sea_shipment_items_goods_id_idx
  on public.sea_shipment_items (goods_id);

alter table public.sea_shipment_items enable row level security;

drop policy if exists "sea_shipment_items_select_own" on public.sea_shipment_items;
create policy "sea_shipment_items_select_own"
  on public.sea_shipment_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.shipments s
      where s.id = shipment_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "sea_shipment_items_admin_all" on public.sea_shipment_items;
create policy "sea_shipment_items_admin_all"
  on public.sea_shipment_items
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

-- Payment create/resubmit: Air OR Sea, only at ready_for_pickup.
-- Air still cannot pay at any other status. Amount snapshot unchanged.
create or replace function public.logistics_payments_enforce_amount_and_eligibility()
returns trigger
language plpgsql
as $$
declare
  ship record;
begin
  if tg_op = 'INSERT' then
    select s.user_id, s.freight_type, s.status, s.total_amount_due
    into ship
    from public.shipments s
    where s.id = new.shipment_id;

    if not found then
      raise exception 'Shipment not found for logistics payment';
    end if;

    if new.user_id is distinct from ship.user_id then
      raise exception 'Logistics payment user must match shipment owner';
    end if;

    if ship.freight_type not in ('air', 'sea')
       or ship.status is distinct from 'ready_for_pickup' then
      raise exception 'Logistics payment is only allowed for Air or Sea shipments that are ready_for_pickup';
    end if;

    new.amount_due := ship.total_amount_due;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.amount_due := old.amount_due;
    new.shipment_id := old.shipment_id;
    new.user_id := old.user_id;
    return new;
  end if;

  return new;
end;
$$;

drop policy if exists "logistics_payments_insert_own" on public.logistics_payments;
create policy "logistics_payments_insert_own"
  on public.logistics_payments
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and submitted_by = auth.uid()
    and status in ('pending', 'submitted')
    and confirmed_at is null
    and reviewed_by is null
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and s.user_id = auth.uid()
        and s.freight_type in ('air', 'sea')
        and s.status = 'ready_for_pickup'
    )
  );

drop policy if exists "logistics_payments_update_own_resubmit" on public.logistics_payments;
create policy "logistics_payments_update_own_resubmit"
  on public.logistics_payments
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and status in ('pending', 'rejected')
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and s.user_id = auth.uid()
        and s.freight_type in ('air', 'sea')
        and s.status = 'ready_for_pickup'
    )
  )
  with check (
    user_id = auth.uid()
    and submitted_by = auth.uid()
    and status = 'submitted'
    and confirmed_at is null
    and reviewed_by is null
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and s.user_id = auth.uid()
        and s.freight_type in ('air', 'sea')
        and s.status = 'ready_for_pickup'
    )
  );

-- Separate Sea completion gate. Does not replace the Air trigger.
create or replace function public.shipments_sea_completed_requires_confirmed_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.freight_type is distinct from 'sea' then
    return new;
  end if;

  if new.status is distinct from 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'ready_for_pickup' then
    raise exception 'Sea shipments can only be completed from ready_for_pickup after confirmed payment';
  end if;

  if not exists (
    select 1
    from public.logistics_payments lp
    where lp.shipment_id = new.id
      and lp.status = 'confirmed'
  ) then
    raise exception 'Sea shipment cannot be completed until logistics payment is confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists shipments_sea_completed_requires_confirmed_payment
  on public.shipments;
create trigger shipments_sea_completed_requires_confirmed_payment
  before insert or update of status on public.shipments
  for each row
  execute procedure public.shipments_sea_completed_requires_confirmed_payment();
