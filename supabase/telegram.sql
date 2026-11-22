-- Phase-one Telegram support inbox, admin-alert outbox, and rate-broadcast log.
-- Apply manually in the Supabase SQL editor for project qslfgnrivaacfwsojjhh.
-- Do not run this from the app, a deploy, or CI.
--
-- This file does not read or write a bot token. It does not call Telegram.
-- Business inserts stay successful even if the outbox cannot be written:
-- both trigger functions catch every error and return the new row.
--
-- Private Telegram message text is stored here. Row level security is forced
-- and there are no policies, so the anon and authenticated keys cannot read
-- or write these rows. The Vercel functions use the service role only after
-- a website admin check or the webhook secret check.

create table if not exists public.telegram_updates (
  update_id bigint primary key,
  kind text not null,
  chat_id text,
  state text not null default 'open' check (state in ('open', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_support_tickets (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  telegram_user_id text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_from_update_id bigint not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telegram_support_one_open_chat
  on public.telegram_support_tickets (chat_id)
  where status = 'open';

create table if not exists public.telegram_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.telegram_support_tickets (id) on delete cascade,
  chat_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null check (char_length(body) between 1 and 1000),
  telegram_update_id bigint unique,
  status text not null check (status in ('stored', 'queued', 'sending', 'sent', 'failed', 'needs_review')),
  attempts int not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  telegram_message_id text,
  author_admin_id uuid,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (direction = 'inbound' and author_admin_id is null and telegram_update_id is not null and status = 'stored')
    or
    (direction = 'outbound' and author_admin_id is not null and telegram_update_id is null)
  )
);

create table if not exists public.telegram_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 120),
  kind text not null check (kind in ('exchange_request', 'logistics_request')),
  record_key text not null check (char_length(record_key) between 4 and 80),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'needs_review', 'cancelled')),
  attempts int not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  delivered_chat_ids text[] not null default '{}',
  telegram_message_id text,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_alert_outbox_status_idx
  on public.telegram_alert_outbox (status, next_attempt_at);

create table if not exists public.telegram_rate_broadcasts (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('preview', 'queued', 'sending', 'sent', 'failed', 'needs_review', 'cancelled')),
  body text not null check (char_length(body) between 1 and 2000),
  rate_line text not null,
  rate_snapshot text not null,
  created_by uuid not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  expires_at timestamptz not null,
  attempts int not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  telegram_message_id text,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_rate_events (
  id bigint generated always as identity primary key,
  bucket_key text not null check (char_length(bucket_key) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists telegram_rate_events_bucket_idx
  on public.telegram_rate_events (bucket_key, created_at);

alter table public.telegram_updates enable row level security;
alter table public.telegram_updates force row level security;
alter table public.telegram_support_tickets enable row level security;
alter table public.telegram_support_tickets force row level security;
alter table public.telegram_support_messages enable row level security;
alter table public.telegram_support_messages force row level security;
alter table public.telegram_alert_outbox enable row level security;
alter table public.telegram_alert_outbox force row level security;
alter table public.telegram_rate_broadcasts enable row level security;
alter table public.telegram_rate_broadcasts force row level security;
alter table public.telegram_rate_events enable row level security;
alter table public.telegram_rate_events force row level security;

revoke all on table public.telegram_updates from public, anon, authenticated;
revoke all on table public.telegram_support_tickets from public, anon, authenticated;
revoke all on table public.telegram_support_messages from public, anon, authenticated;
revoke all on table public.telegram_alert_outbox from public, anon, authenticated;
revoke all on table public.telegram_rate_broadcasts from public, anon, authenticated;
revoke all on table public.telegram_rate_events from public, anon, authenticated;

-- Trigger functions are security definer so they can write the outbox while
-- the signed-in user cannot. Execute stays granted to anon and authenticated
-- because revoking it would make the trigger fail before its exception
-- handler runs, and that would reject the exchange or packing insert.
-- The functions take no caller arguments and copy only a reference key.

create or replace function public.telegram_enqueue_exchange()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.reference_number is null
      or btrim(new.reference_number::text) !~ '^[A-Za-z0-9-]{4,40}$' then
      return new;
    end if;
    insert into public.telegram_alert_outbox (dedupe_key, kind, record_key, status)
    values (
      'exchange:' || btrim(new.reference_number::text),
      'exchange_request',
      btrim(new.reference_number::text),
      'queued'
    )
    on conflict (dedupe_key) do nothing;
  exception when others then
    return new;
  end;
  return new;
end;
$$;

create or replace function public.telegram_enqueue_logistics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.telegram_alert_outbox (dedupe_key, kind, record_key, status, next_attempt_at)
    values (
      'logistics:' || new.request_id::text,
      'logistics_request',
      new.request_id::text,
      'queued',
      now() + interval '2 minutes'
    )
    on conflict (dedupe_key) do nothing;
  exception when others then
    return new;
  end;
  return new;
end;
$$;

grant execute on function public.telegram_enqueue_exchange() to anon, authenticated;
grant execute on function public.telegram_enqueue_logistics() to anon, authenticated;

do $$
begin
  if to_regclass('public.exchange_requests') is null then
    raise exception 'telegram.sql requires public.exchange_requests';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exchange_requests'
      and column_name = 'reference_number'
  ) then
    raise exception 'telegram.sql requires exchange_requests.reference_number';
  end if;
  if to_regclass('public.packing_requests') is null then
    raise exception 'telegram.sql requires public.packing_requests';
  end if;
  if to_regclass('public.air_packing_request_items') is null then
    raise exception 'telegram.sql requires public.air_packing_request_items';
  end if;
end $$;

drop trigger if exists telegram_exchange_request_ai on public.exchange_requests;
create trigger telegram_exchange_request_ai
  after insert on public.exchange_requests
  for each row
  execute function public.telegram_enqueue_exchange();

drop trigger if exists telegram_air_packing_item_ai on public.air_packing_request_items;
create trigger telegram_air_packing_item_ai
  after insert on public.air_packing_request_items
  for each row
  execute function public.telegram_enqueue_logistics();

do $$
begin
  if to_regclass('public.sea_packing_request_items') is null then
    raise notice 'sea_packing_request_items is absent; re-run telegram.sql after sea freight SQL to alert on sea requests';
    return;
  end if;
  execute 'drop trigger if exists telegram_sea_packing_item_ai on public.sea_packing_request_items';
  execute 'create trigger telegram_sea_packing_item_ai after insert on public.sea_packing_request_items for each row execute function public.telegram_enqueue_logistics()';
end $$;
