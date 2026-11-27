// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY } from '../passkeys/publicSupabase';
import { loadTelegramConfig } from './config';
import { EXCHANGE_ALERT_COLUMNS, LOGISTICS_ALERT_COLUMNS, RATE_COLUMNS } from './business';

const serviceRole = 'service-role-key-which-is-not-the-anon-key';

function reasons(overrides: Record<string, string> = {}): string[] {
  const loaded = loadTelegramConfig(env(overrides));
  if (loaded.ok) throw new Error('expected the configuration to fail');
  return loaded.reasons;
}

function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456789:AAHexampleTokenValueForTestsOnly',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
    TELEGRAM_SITE_URL: 'https://koolmovez.com',
    TELEGRAM_ADMIN_CHAT_IDS: '10001,10002',
    TELEGRAM_CHANNEL_ID: '-1001234567890',
    TELEGRAM_WORKER_SECRET: 'test-worker-secret-value',
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    ...overrides,
  };
}

describe('loadTelegramConfig', () => {
  it('stays disabled until the master switch is exactly true', () => {
    expect(loadTelegramConfig({}).ok).toBe(false);
    const switchedOff = loadTelegramConfig({ TELEGRAM_ENABLED: 'false' });
    expect(switchedOff.ok).toBe(false);
    if (!switchedOff.ok) expect(switchedOff.reasons).toEqual(['disabled']);
    expect(loadTelegramConfig({ VITE_TELEGRAM_BOT_TOKEN: '123456789:AAHexampleTokenValueForTestsOnly' }).ok).toBe(false);
  });

  it('accepts server env and never reads a VITE token', () => {
    const loaded = loadTelegramConfig(env({ VITE_TELEGRAM_BOT_TOKEN: '999999:AAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.botToken).toBe('123456789:AAHexampleTokenValueForTestsOnly');
    expect(loaded.config.adminChatIds).toEqual(['10001', '10002']);
    expect(loaded.config.channelId).toBe('-1001234567890');
    expect(loaded.config.siteUrl).toBe('https://koolmovez.com');
    expect(JSON.stringify({ adminChatIds: loaded.config.adminChatIds })).not.toContain(loaded.config.botToken);
  });

  it('rejects usernames, private chats as the channel, preview hosts, and the anon key', () => {
    expect(reasons({ TELEGRAM_ADMIN_CHAT_IDS: '@KoolmovezAdmin' })).toContain('invalid_admin_chat_ids');
    expect(reasons({ TELEGRAM_ADMIN_CHAT_IDS: '10001,admin' })).toContain('invalid_admin_chat_ids');
    expect(reasons({ TELEGRAM_CHANNEL_ID: '10001' })).toContain('invalid_channel_id');
    expect(reasons({ TELEGRAM_CHANNEL_ID: '@koolmovez' })).toContain('invalid_channel_id');
    expect(reasons({ TELEGRAM_SITE_URL: 'https://koolmoves.vercel.app' })).toContain('invalid_site_url');
    expect(reasons({ SUPABASE_SERVICE_ROLE_KEY: PUBLIC_SUPABASE_ANON_KEY })).toContain('invalid_service_role');
    expect(reasons({ TELEGRAM_BOT_TOKEN: '' })).toContain('missing_bot_token');
    expect(reasons({ TELEGRAM_WEBHOOK_SECRET: '' })).toContain('missing_webhook_secret');
  });

  it('fails closed on a preview deployment even if the token is present', () => {
    expect(reasons({ VERCEL_ENV: 'preview' })).toEqual(['not_production']);
    expect(loadTelegramConfig(env({ VERCEL_ENV: 'production' })).ok).toBe(true);
  });

  it('allows alerts without a channel, and a channel without naming it in the browser', () => {
    const alertsOnly = loadTelegramConfig(env({ TELEGRAM_CHANNEL_ID: '' }));
    expect(alertsOnly.ok).toBe(true);
    if (!alertsOnly.ok) return;
    expect(alertsOnly.config.channelId).toBeNull();
    const noAdmins = loadTelegramConfig(env({ TELEGRAM_ADMIN_CHAT_IDS: '' }));
    expect(noAdmins.ok).toBe(true);
  });
});

describe('telegram SQL', () => {
  const sql = readFileSync(new URL('../../supabase/telegram.sql', import.meta.url), 'utf8').toLowerCase();
  const rollback = readFileSync(new URL('../../supabase/telegram_rollback.sql', import.meta.url), 'utf8').toLowerCase();

  it('keeps private messages server-only and does not block business writes', () => {
    expect(sql).toContain('force row level security');
    expect(sql).toContain('revoke all on table public.telegram_support_messages from public, anon, authenticated');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
    expect(sql).toContain('exception when others then');
    expect(sql).toContain('on conflict (dedupe_key) do nothing');
    expect(sql).toContain('after insert on public.exchange_requests');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain('timeout_milliseconds := 10000');
    expect(sql).toContain('telegram_notify_dispatcher');
    expect(sql).toContain('support_request');
    expect(sql).not.toContain('2 minutes');
    expect(sql).toContain('revoke all on function public.telegram_notify_dispatcher() from public, anon, authenticated');
    expect(sql).toContain('after insert on public.air_packing_request_items');
    expect(sql).not.toContain('user_email');
    expect(sql).not.toContain('user_phone');
    expect(sql).not.toContain('receipt');
    expect(sql).not.toContain('bot_token');
    expect(sql).not.toContain('api.telegram.org');
  });

  it('rolls back only telegram objects', () => {
    expect(rollback).toContain('drop table if exists public.telegram_support_messages');
    expect(rollback).toContain('drop trigger if exists telegram_exchange_request_ai');
    expect(rollback).toContain('drop trigger if exists telegram_exchange_rate_aiud on public.site_settings');
    expect(rollback).toContain('drop function if exists public.telegram_enqueue_rate_change()');
    expect(rollback).toContain('drop table if exists public.telegram_rate_changes');
    expect(rollback).toContain('drop table if exists public.telegram_dispatch_config');
    expect(rollback).toContain('drop function if exists public.telegram_notify_dispatcher()');
    expect(rollback).not.toContain('drop table if exists public.exchange_requests');
    expect(rollback).not.toContain('drop table if exists public.packing_requests');
    expect(rollback).not.toContain('drop table if exists public.site_settings');
  });
});

describe('exchange rate autopost SQL', () => {
  const sql = readFileSync(new URL('../../supabase/telegram_rate_autopost.sql', import.meta.url), 'utf8').toLowerCase();
  const executable = sql.replace(/--[^\n]*/g, '');

  it('queues one channel post for a changed exchange_rate and does not schedule, debounce, or cap the day', () => {
    expect(sql).toContain("is distinct from 'exchange_rate'");
    expect(sql).toContain('is not distinct from btrim');
    expect(sql).toContain('telegram_notify_dispatcher');
    expect(sql).toContain('after insert or update of value on public.site_settings');
    expect(sql).toContain('exception when others then');
    expect(sql).toContain('source_change_id');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('revoke all on table public.telegram_rate_changes from public, anon, authenticated');
    expect(executable).not.toContain('pg_sleep');
    expect(executable).not.toContain('debounce');
    expect(executable).not.toContain('cron');
    expect(executable).not.toContain('interval');
    expect(sql).not.toContain('bot_token');
    expect(sql).not.toContain('api.telegram.org');
    expect(sql).not.toContain('packing_fee');
    expect(sql).not.toContain('freight_fee');
    expect(sql).not.toContain('clearing_fee');
    expect(sql).not.toContain('drop table if exists public.site_settings');
  });
});

describe('alert queries', () => {
  it('selects reference, type, and status fields only', () => {
    const columns = `${EXCHANGE_ALERT_COLUMNS} ${LOGISTICS_ALERT_COLUMNS} ${RATE_COLUMNS}`.toLowerCase();
    expect(columns).not.toContain('email');
    expect(columns).not.toContain('phone');
    expect(columns).not.toContain('receipt');
    expect(columns).not.toContain('account');
    expect(columns).not.toContain('qr');
  });
});
