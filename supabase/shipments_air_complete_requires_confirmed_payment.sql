-- KoolMovez Logistics — Air completion requires confirmed payment
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, air_freight_goods.sql, logistics_payments.sql,
-- or the full shipments.sql.
--
-- Air shipments cannot change to status = 'completed' unless
-- public.logistics_payments for that shipment is status = 'confirmed'.
-- Sea shipments are not gated by this trigger.
-- Payment statuses are not added to shipments.status.

create or replace function public.shipments_air_completed_requires_confirmed_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.freight_type is distinct from 'air' then
    return new;
  end if;

  if new.status is distinct from 'completed' then
    return new;
  end if;

  -- Already completed: allow other column updates.
  if tg_op = 'UPDATE' and old.status is not distinct from 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'ready_for_pickup' then
    raise exception 'Air shipments can only be completed from ready_for_pickup after confirmed payment';
  end if;

  if not exists (
    select 1
    from public.logistics_payments lp
    where lp.shipment_id = new.id
      and lp.status = 'confirmed'
  ) then
    raise exception 'Air shipment cannot be completed until logistics payment is confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists shipments_air_completed_requires_confirmed_payment
  on public.shipments;
create trigger shipments_air_completed_requires_confirmed_payment
  before insert or update of status on public.shipments
  for each row
  execute procedure public.shipments_air_completed_requires_confirmed_payment();
