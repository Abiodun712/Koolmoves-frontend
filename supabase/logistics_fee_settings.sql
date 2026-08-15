-- KoolMovez Logistics — fee setting keys in public.site_settings
-- Apply ONLY this file in the Supabase SQL Editor.
-- Do NOT re-run warehouses.sql, shipments.sql, logistics_payments.sql,
-- or air_freight_goods.sql.
--
-- Seeds missing Logistics fee keys. Existing values are not overwritten.
-- Does not change exchange_rate, platform_status, or air_freight_notice.
-- Warehouse admin support already exists (is_active + warehouses_admin_all).

insert into public.site_settings (key, value, updated_at)
values
  ('air_freight_fee', '0', now()),
  ('sea_freight_fee', '0', now()),
  ('packing_fee', '0', now()),
  ('clearing_fee', '0', now()),
  ('storage_fee_per_day', '0', now())
on conflict (key) do nothing;
