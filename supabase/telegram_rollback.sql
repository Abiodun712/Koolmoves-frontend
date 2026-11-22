-- Rollback for supabase/telegram.sql.
-- Run this only to remove the Telegram phase-one tables.
-- Do not run it during setup. It does not drop exchange_requests,
-- packing_requests, site_settings, profiles, or any logistics table.

drop trigger if exists telegram_exchange_request_ai on public.exchange_requests;
drop trigger if exists telegram_air_packing_item_ai on public.air_packing_request_items;
drop trigger if exists telegram_sea_packing_item_ai on public.sea_packing_request_items;

drop function if exists public.telegram_enqueue_exchange();
drop function if exists public.telegram_enqueue_logistics();

drop table if exists public.telegram_support_messages;
drop table if exists public.telegram_support_tickets;
drop table if exists public.telegram_alert_outbox;
drop table if exists public.telegram_rate_broadcasts;
drop table if exists public.telegram_rate_events;
drop table if exists public.telegram_updates;
