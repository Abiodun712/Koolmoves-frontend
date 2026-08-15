-- KoolMovez Logistics — payment records (separate from Exchange/Koolswitch)
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, air_freight_goods.sql, or the full shipments.sql.
--
-- Creates:
--   public.logistics_payments
--   trigger to snapshot/lock amount_due from shipments.total_amount_due
--   storage bucket logistics-payment-receipts (private)
-- Payment statuses are NOT added to shipments.status.

create table if not exists public.logistics_payments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references public.shipments (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'confirmed', 'rejected')),
  receipt_path text,
  amount_due numeric(14, 2),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  rejection_note text,
  submitted_by uuid references auth.users (id),
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists logistics_payments_user_id_idx
  on public.logistics_payments (user_id);

create index if not exists logistics_payments_status_idx
  on public.logistics_payments (status);

-- Snapshot amount_due from the shipment on INSERT; never allow later changes.
-- Also require Air + ready_for_pickup on INSERT (defense in depth with RLS).
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

    if ship.freight_type is distinct from 'air'
       or ship.status is distinct from 'ready_for_pickup' then
      raise exception 'Logistics payment is only allowed for Air shipments that are ready_for_pickup';
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

drop trigger if exists logistics_payments_enforce_amount_and_eligibility
  on public.logistics_payments;
create trigger logistics_payments_enforce_amount_and_eligibility
  before insert or update on public.logistics_payments
  for each row
  execute procedure public.logistics_payments_enforce_amount_and_eligibility();

alter table public.logistics_payments enable row level security;

drop policy if exists "logistics_payments_select_own" on public.logistics_payments;
create policy "logistics_payments_select_own"
  on public.logistics_payments
  for select
  to authenticated
  using (user_id = auth.uid());

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
        and s.freight_type = 'air'
        and s.status = 'ready_for_pickup'
    )
  );

-- Users may resubmit only from pending/rejected. They cannot update submitted/confirmed
-- rows and cannot set status to confirmed or rejected.
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
        and s.freight_type = 'air'
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
        and s.freight_type = 'air'
        and s.status = 'ready_for_pickup'
    )
  );

drop policy if exists "logistics_payments_admin_all" on public.logistics_payments;
create policy "logistics_payments_admin_all"
  on public.logistics_payments
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

insert into storage.buckets (id, name, public)
values ('logistics-payment-receipts', 'logistics-payment-receipts', false)
on conflict (id) do nothing;

drop policy if exists "logistics_receipts_select_own" on storage.objects;
create policy "logistics_receipts_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'logistics-payment-receipts'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "logistics_receipts_insert_own" on storage.objects;
create policy "logistics_receipts_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'logistics-payment-receipts'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "logistics_receipts_admin_all" on storage.objects;
create policy "logistics_receipts_admin_all"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'logistics-payment-receipts'
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    bucket_id = 'logistics-payment-receipts'
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );
