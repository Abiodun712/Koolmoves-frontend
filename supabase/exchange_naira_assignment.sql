-- One company Naira account per customer exchange transaction.
-- Apply ONLY this file in the Supabase SQL editor for project qslfgnrivaacfwsojjhh.
-- Do not re-run other SQL files. Do not change env vars, secrets, webhooks, or live config from here.
-- This script does not drop exchange_requests, packing_requests, admin_banks, or payment receipts.
--
-- Pool: public.admin_banks rows whose status is active. That is the list the exchange
-- screen already read. public.bank_accounts is a separate unused screen and is not used.
--
-- Customers cannot list admin_banks. request_exchange_naira_account returns one account
-- and stores it on (user_id, transaction_key). A later call for that same key returns
-- the stored account and does not pick again.
--
-- Until this file is applied, the website keeps Naira account details hidden.

alter table public.admin_banks enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_banks'
      and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.admin_banks', pol.policyname);
  end loop;
end $$;

drop policy if exists "admin_banks_admin_all" on public.admin_banks;
create policy "admin_banks_admin_all"
  on public.admin_banks
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

create table if not exists public.exchange_naira_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id),
  transaction_key text not null,
  admin_bank_id bigint references public.admin_banks (id) on delete set null,
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  exchange_reference text,
  created_at timestamptz not null default now(),
  constraint exchange_naira_assignments_user_transaction_key unique (user_id, transaction_key)
);

create index if not exists exchange_naira_assignments_user_reference_idx
  on public.exchange_naira_assignments (user_id, exchange_reference);

alter table public.exchange_naira_assignments enable row level security;

revoke all on table public.exchange_naira_assignments from public, anon, authenticated;
grant select on table public.exchange_naira_assignments to authenticated;
grant all on table public.exchange_naira_assignments to service_role;

drop policy if exists "exchange_naira_assignments_select_own" on public.exchange_naira_assignments;
create policy "exchange_naira_assignments_select_own"
  on public.exchange_naira_assignments
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "exchange_naira_assignments_admin_select" on public.exchange_naira_assignments;
create policy "exchange_naira_assignments_admin_select"
  on public.exchange_naira_assignments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

create or replace function public.request_exchange_naira_account(p_transaction_key text)
returns table (
  bank_name text,
  account_name text,
  account_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.exchange_naira_assignments%rowtype;
  picked_id bigint;
  picked_bank_name text;
  picked_account_name text;
  picked_account_number text;
  live_bank_name text;
  live_account_name text;
  live_account_number text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_transaction_key is null
     or p_transaction_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid_transaction';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_transaction_key, 0));

  select a.*
  into existing
  from public.exchange_naira_assignments a
  where a.user_id = uid
    and a.transaction_key = p_transaction_key;

  if found then
    if existing.admin_bank_id is not null then
      select b.bank_name, b.account_name, b.account_number
      into live_bank_name, live_account_name, live_account_number
      from public.admin_banks b
      where b.id = existing.admin_bank_id;

      if live_account_number is not null then
        bank_name := live_bank_name;
        account_name := live_account_name;
        account_number := live_account_number;
        return next;
        return;
      end if;
    end if;

    bank_name := existing.bank_name;
    account_name := existing.account_name;
    account_number := existing.account_number;
    return next;
    return;
  end if;

  select b.id, b.bank_name, b.account_name, b.account_number
  into picked_id, picked_bank_name, picked_account_name, picked_account_number
  from public.admin_banks b
  where lower(coalesce(b.status, '')) = 'active'
    and nullif(trim(b.bank_name), '') is not null
    and nullif(trim(b.account_name), '') is not null
    and nullif(trim(b.account_number), '') is not null
  order by random()
  limit 1;

  if picked_id is null then
    raise exception 'no_active_naira_account';
  end if;

  insert into public.exchange_naira_assignments (
    user_id,
    transaction_key,
    admin_bank_id,
    bank_name,
    account_name,
    account_number
  )
  values (
    uid,
    p_transaction_key,
    picked_id,
    picked_bank_name,
    picked_account_name,
    picked_account_number
  )
  on conflict (user_id, transaction_key) do nothing;

  select a.*
  into existing
  from public.exchange_naira_assignments a
  where a.user_id = uid
    and a.transaction_key = p_transaction_key;

  if not found then
    return;
  end if;

  if existing.admin_bank_id is not null then
    select b.bank_name, b.account_name, b.account_number
    into live_bank_name, live_account_name, live_account_number
    from public.admin_banks b
    where b.id = existing.admin_bank_id;

    if live_account_number is not null then
      bank_name := live_bank_name;
      account_name := live_account_name;
      account_number := live_account_number;
      return next;
      return;
    end if;
  end if;

  bank_name := existing.bank_name;
  account_name := existing.account_name;
  account_number := existing.account_number;
  return next;
end;
$$;

create or replace function public.attach_exchange_naira_account(
  p_transaction_key text,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;

  if p_transaction_key is null
     or p_transaction_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return;
  end if;

  if p_reference is null or p_reference !~ '^[A-Za-z0-9-]{4,40}$' then
    return;
  end if;

  update public.exchange_naira_assignments a
  set exchange_reference = p_reference
  where a.user_id = uid
    and a.transaction_key = p_transaction_key
    and exists (
      select 1
      from public.exchange_requests r
      where r.user_id = uid
        and r.reference_number = p_reference
    );
end;
$$;

revoke all on function public.request_exchange_naira_account(text) from public, anon;
grant execute on function public.request_exchange_naira_account(text) to authenticated;

revoke all on function public.attach_exchange_naira_account(text, text) from public, anon;
grant execute on function public.attach_exchange_naira_account(text, text) to authenticated;
