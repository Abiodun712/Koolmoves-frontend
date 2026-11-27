-- Post a changed published exchange rate to the Telegram channel.
-- Apply manually in the Supabase SQL editor after supabase/telegram.sql.
-- Safe to re-run. Do not run this from the app, a deploy, or CI.
--
-- One row is written for each committed change of site_settings.exchange_rate.
-- There is no daily cap, debounce, or coalesce. The same dispatcher used for
-- request alerts calls the worker after the commit. The website save does not
-- roll back if this queue cannot be written.
--
-- This file does not read a bot token and does not call Telegram.

alter table public.telegram_rate_broadcasts
  add column if not exists source_change_id uuid;

create unique index if not exists telegram_rate_broadcasts_source_change_idx
  on public.telegram_rate_broadcasts (source_change_id)
  where source_change_id is not null;

create table if not exists public.telegram_rate_changes (
  id uuid primary key default gen_random_uuid(),
  rate_value text not null check (char_length(rate_value) between 1 and 80),
  previous_value text check (previous_value is null or char_length(previous_value) between 1 and 80),
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'skipped')),
  broadcast_id uuid,
  created_by uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_rate_changes_status_idx
  on public.telegram_rate_changes (status, created_at);

alter table public.telegram_rate_changes enable row level security;
alter table public.telegram_rate_changes force row level security;
revoke all on table public.telegram_rate_changes from public, anon, authenticated;

-- security definer so the signed-in admin can save the rate without being
-- granted the Telegram tables. Execute stays granted to anon and authenticated
-- because revoking it would fail the trigger before this exception handler.
create or replace function public.telegram_enqueue_rate_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.key::text is distinct from 'exchange_rate' then
      return new;
    end if;
    if tg_op = 'UPDATE'
      and btrim(coalesce(new.value::text, '')) is not distinct from btrim(coalesce(old.value::text, '')) then
      return new;
    end if;
    if new.value is null
      or char_length(btrim(new.value::text)) = 0
      or char_length(btrim(new.value::text)) > 80 then
      return new;
    end if;
    insert into public.telegram_rate_changes (rate_value, previous_value, status, created_by)
    values (
      btrim(new.value::text),
      case
        when tg_op = 'UPDATE'
          and old.value is not null
          and char_length(btrim(old.value::text)) between 1 and 80
          then btrim(old.value::text)
        else null
      end,
      'queued',
      auth.uid()
    );
  exception when others then
    return new;
  end;
  begin
    perform public.telegram_notify_dispatcher();
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.telegram_enqueue_rate_change() from public;
grant execute on function public.telegram_enqueue_rate_change() to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.site_settings') is null then
    raise notice 'site_settings is absent; re-run supabase/telegram_rate_autopost.sql after that table exists';
    return;
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_settings'
      and column_name = 'key'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_settings'
      and column_name = 'value'
  ) then
    raise exception 'telegram_rate_autopost.sql requires site_settings.key and site_settings.value';
  end if;
  execute 'drop trigger if exists telegram_exchange_rate_aiud on public.site_settings';
  execute 'create trigger telegram_exchange_rate_aiud after insert or update of value on public.site_settings for each row execute function public.telegram_enqueue_rate_change()';
end $$;
