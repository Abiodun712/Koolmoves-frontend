-- KoolMovez admin notifications for customer exchange submissions.
-- Apply ONLY this file in the Supabase SQL editor (project ref qslfgnrivaacfwsojjhh).
-- Do NOT re-run other SQL files in this folder.
-- Safe to run more than once.
--
-- Creates:
--   public.admin_notifications
--   insert trigger on public.exchange_requests so a saved exchange still notifies
--     the admin if the browser never finishes the follow-up insert
--   RLS: the submitting customer can insert one row for their own reference;
--     only profiles.role = 'admin' can read and mark notifications read
--   Realtime publication membership when supabase_realtime exists
--
-- The trigger swallows its own errors. A notification failure must not roll back
-- the exchange request insert.
--
-- No Vercel env vars or provider setting changes are required.
-- After this runs, a signed-in admin sees new rows in the admin notification
-- list. The open admin page polls every 20s. Realtime (added below) updates it
-- sooner when the publication is present.

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  reference_number text,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_notifications_kind_reference_key unique (kind, reference_number)
);

create index if not exists admin_notifications_unread_created_idx
  on public.admin_notifications (created_at desc)
  where read_at is null;

alter table public.admin_notifications replica identity full;

-- Same sentence as buildExchangeSubmittedNotification in
-- src/lib/adminExchangeNotification.ts
-- Examples:
--   ('KMX-123456', 100, 21000, 'KM-0042', 'a@b.co')
--     -> Exchange KMX-123456 submitted for 100 RMB by KM-0042. Total to pay: ₦21,000.
--   ('KMX-1', 50, 10500.5, null, 'a@b.co')
--     -> Exchange KMX-1 submitted for 50 RMB by a@b.co. Total to pay: ₦10,500.5.
--   ('KMX-1', null, null, null, null)
--     -> Exchange KMX-1 submitted.

create or replace function public.format_admin_notification_amount(amount numeric)
returns text
language plpgsql
immutable
as $$
declare
  rounded numeric;
  whole text;
  frac text;
  negative boolean := false;
  grouped text := '';
  i int;
begin
  if amount is null then
    return '';
  end if;
  if amount < 0 then
    negative := true;
    amount := -amount;
  end if;

  rounded := round(amount, 2);
  whole := to_char(trunc(rounded), 'FM999999999999999');
  if rounded = trunc(rounded) then
    frac := '';
  else
    frac := split_part(to_char(rounded, 'FM999999999999990.00'), '.', 2);
    frac := rtrim(frac, '0');
  end if;

  i := length(whole);
  while i > 0 loop
    if grouped <> '' then
      grouped := ',' || grouped;
    end if;
    if i > 3 then
      grouped := substr(whole, i - 2, 3) || grouped;
      i := i - 3;
    else
      grouped := substr(whole, 1, i) || grouped;
      i := 0;
    end if;
  end loop;

  return (case when negative then '-' else '' end)
    || grouped
    || (case when frac <> '' then '.' || frac else '' end);
end;
$$;

create or replace function public.admin_exchange_notification_body(
  reference_number text,
  rmb_amount numeric,
  naira_amount numeric,
  km_id text,
  user_email text
)
returns text
language plpgsql
immutable
as $$
declare
  sentence text := 'Exchange ' || coalesce(reference_number, '') || ' submitted';
  who text := nullif(trim(coalesce(km_id, '')), '');
  email text := nullif(trim(coalesce(user_email, '')), '');
begin
  if rmb_amount is not null then
    sentence := sentence || ' for ' || public.format_admin_notification_amount(rmb_amount) || ' RMB';
  end if;
  if who is not null then
    sentence := sentence || ' by ' || who;
  elsif email is not null then
    sentence := sentence || ' by ' || email;
  end if;
  sentence := sentence || '.';
  if naira_amount is not null then
    sentence := sentence || ' Total to pay: ₦' || public.format_admin_notification_amount(naira_amount) || '.';
  end if;
  return sentence;
end;
$$;

create or replace function public.user_owns_exchange_reference(reference_number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exchange_requests er
    where er.reference_number = user_owns_exchange_reference.reference_number
      and er.user_id = auth.uid()
  );
$$;

create or replace function public.notify_admin_exchange_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reference_number is null or length(trim(new.reference_number)) = 0 then
    return new;
  end if;

  begin
    insert into public.admin_notifications (kind, reference_number, title, body)
    values (
      'exchange_submitted',
      new.reference_number,
      'New exchange request',
      public.admin_exchange_notification_body(
        new.reference_number,
        new.rmb_amount,
        coalesce(new.total_to_pay, new.naira_amount),
        new.km_id,
        new.user_email
      )
    )
    on conflict (kind, reference_number) do nothing;
  exception when others then
    raise warning 'admin exchange notification skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists exchange_requests_notify_admin on public.exchange_requests;
create trigger exchange_requests_notify_admin
  after insert on public.exchange_requests
  for each row
  execute procedure public.notify_admin_exchange_submitted();

alter table public.admin_notifications enable row level security;

drop policy if exists "admin_notifications_insert_own_exchange" on public.admin_notifications;
create policy "admin_notifications_insert_own_exchange"
  on public.admin_notifications
  for insert
  to authenticated
  with check (
    kind = 'exchange_submitted'
    and reference_number is not null
    and title = 'New exchange request'
    and char_length(body) <= 1000
    and public.user_owns_exchange_reference(reference_number)
  );

drop policy if exists "admin_notifications_admin_select" on public.admin_notifications;
create policy "admin_notifications_admin_select"
  on public.admin_notifications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "admin_notifications_admin_update" on public.admin_notifications;
create policy "admin_notifications_admin_update"
  on public.admin_notifications
  for update
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

revoke all on public.admin_notifications from anon;
grant select, insert, update on public.admin_notifications to authenticated;

revoke all on function public.format_admin_notification_amount(numeric) from public, anon, authenticated;
revoke all on function public.admin_exchange_notification_body(text, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.notify_admin_exchange_submitted() from public, anon, authenticated;
revoke all on function public.user_owns_exchange_reference(text) from public, anon;
grant execute on function public.user_owns_exchange_reference(text) to authenticated;

-- Pending submissions from the last 14 days become unread notifications.
-- A column mismatch only skips the backfill; the table and trigger still stand.
do $$
begin
  insert into public.admin_notifications (kind, reference_number, title, body)
  select
    'exchange_submitted',
    er.reference_number,
    'New exchange request',
    public.admin_exchange_notification_body(
      er.reference_number,
      er.rmb_amount,
      coalesce(er.total_to_pay, er.naira_amount),
      er.km_id,
      er.user_email
    )
  from public.exchange_requests er
  where er.reference_number is not null
    and er.status = 'pending'
    and er.created_at > now() - interval '14 days'
  on conflict (kind, reference_number) do nothing;
exception when others then
  raise warning 'admin notification backfill skipped: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'admin_notifications'
    ) then
      alter publication supabase_realtime add table public.admin_notifications;
    end if;
  end if;
end $$;
