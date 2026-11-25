import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '../passkeys/publicSupabase.js';

export type TelegramConfig = {
  botToken: string;
  webhookSecret: string;
  adminChatIds: string[];
  channelId: string | null;
  siteUrl: string;
  siteHost: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  serviceRoleKey: string;
  workerSecrets: string[];
};

export type TelegramConfigResult =
  | { ok: true; config: TelegramConfig }
  | { ok: false; reasons: string[] };

const BOT_TOKEN = /^\d{6,15}:[A-Za-z0-9_-]{20,}$/;
const ADMIN_CHAT = /^[1-9]\d{4,19}$/;
const CHANNEL_ID = /^-100\d{5,17}$/;

export function loadTelegramConfig(env: Record<string, string | undefined>): TelegramConfigResult {
  if ((env.VERCEL_ENV ?? '').trim() && env.VERCEL_ENV?.trim() !== 'production') {
    return { ok: false, reasons: ['not_production'] };
  }
  if (env.TELEGRAM_ENABLED?.trim() !== 'true') {
    return { ok: false, reasons: ['disabled'] };
  }

  const reasons: string[] = [];
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const site = normalizeSite(env.TELEGRAM_SITE_URL?.trim() ?? '');
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const supabaseUrl = (env.SUPABASE_URL?.trim() || PUBLIC_SUPABASE_URL).replace(/\/$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() || PUBLIC_SUPABASE_ANON_KEY;

  if (!botToken) reasons.push('missing_bot_token');
  else if (!BOT_TOKEN.test(botToken)) reasons.push('invalid_bot_token');

  if (!webhookSecret) reasons.push('missing_webhook_secret');
  else if (
    webhookSecret.length < 16 ||
    webhookSecret.length > 256 ||
    webhookSecret !== webhookSecret.trim() ||
    /\s/.test(webhookSecret)
  ) {
    reasons.push('invalid_webhook_secret');
  }

  if (!env.TELEGRAM_SITE_URL?.trim()) reasons.push('missing_site_url');
  else if (!site) reasons.push('invalid_site_url');

  if (!serviceRoleKey) reasons.push('missing_service_role');
  else if (
    serviceRoleKey.length < 20 ||
    serviceRoleKey === supabaseAnonKey ||
    serviceRoleKey === PUBLIC_SUPABASE_ANON_KEY
  ) {
    reasons.push('invalid_service_role');
  }
  if (!isHttpsOrigin(supabaseUrl)) reasons.push('invalid_supabase_url');

  const adminChatIds = parseAdminChats(env.TELEGRAM_ADMIN_CHAT_IDS ?? '', reasons);
  const channelId = parseChannel(env.TELEGRAM_CHANNEL_ID ?? '', reasons);
  const workerSecrets = parseWorkerSecrets(env, reasons);

  if (reasons.length > 0 || !site) {
    return { ok: false, reasons: reasons.length > 0 ? reasons : ['invalid'] };
  }

  return {
    ok: true,
    config: {
      botToken,
      webhookSecret,
      adminChatIds,
      channelId,
      siteUrl: site.origin,
      siteHost: site.host,
      supabaseUrl,
      supabaseAnonKey,
      serviceRoleKey,
      workerSecrets,
    },
  };
}

export type SubsystemStatus = {
  integration: 'enabled' | 'disabled';
  reasons: string[];
  webhook: 'ready' | 'disabled';
  alerts: 'ready' | 'missing_admin_chats' | 'disabled';
  broadcast: 'ready' | 'missing_channel' | 'disabled';
  worker: 'ready' | 'missing_worker_secret' | 'disabled';
};

export function subsystemStatus(config: TelegramConfig | null, reasons: string[]): SubsystemStatus {
  if (!config) {
    return {
      integration: 'disabled',
      reasons,
      webhook: 'disabled',
      alerts: 'disabled',
      broadcast: 'disabled',
      worker: 'disabled',
    };
  }
  return {
    integration: 'enabled',
    reasons: [],
    webhook: 'ready',
    alerts: config.adminChatIds.length > 0 ? 'ready' : 'missing_admin_chats',
    broadcast: config.channelId ? 'ready' : 'missing_channel',
    worker: config.workerSecrets.length > 0 ? 'ready' : 'missing_worker_secret',
  };
}

function parseAdminChats(raw: string, reasons: string[]): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (
    parts.length < 1 ||
    parts.length > 10 ||
    new Set(parts).size !== parts.length ||
    parts.some((part) => !ADMIN_CHAT.test(part))
  ) {
    reasons.push('invalid_admin_chat_ids');
    return [];
  }
  return parts;
}

function parseChannel(raw: string, reasons: string[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!CHANNEL_ID.test(trimmed)) {
    reasons.push('invalid_channel_id');
    return null;
  }
  return trimmed;
}

function parseWorkerSecrets(env: Record<string, string | undefined>, reasons: string[]): string[] {
  const secrets: string[] = [];
  for (const name of ['TELEGRAM_WORKER_SECRET', 'CRON_SECRET'] as const) {
    const value = env[name] ?? '';
    if (!value) continue;
    if (value.trim() !== value || value.length < 16 || value.length > 256 || /\s/.test(value)) {
      reasons.push('invalid_worker_secret');
      continue;
    }
    if (!secrets.includes(value)) secrets.push(value);
  }
  return secrets;
}

function normalizeSite(value: string): { origin: string; host: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    if (host === 'vercel.app' || host.endsWith('.vercel.app')) return null;
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return null;
    return { origin: `https://${host}`, host };
  } catch {
    return null;
  }
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
