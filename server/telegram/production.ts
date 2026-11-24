import { createClient } from '@supabase/supabase-js';
import { createTelegramClient, disabledTelegramClient } from './client';
import { loadTelegramConfig, type TelegramConfig } from './config';
import { createTelegramService } from './service';
import { createMemoryTelegramStore } from './memoryStore';
import { createSupabaseBusiness, createSupabaseTelegramStore } from './supabase';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '../passkeys/publicSupabase';

export type ServerAuth = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  serviceRoleKey: string;
};

const loaded = loadTelegramConfig(process.env);
const authEnv = loadServerAuth(process.env);

let service: ReturnType<typeof createTelegramService> | undefined;

export function telegramWebhook(request: Request): Promise<Response> {
  return current().webhook(request);
}

export function telegramAdmin(request: Request): Promise<Response> {
  return current().admin(request);
}

export function telegramWorker(request: Request): Promise<Response> {
  return current().worker(request);
}

export function isAdminRole(role: unknown): boolean {
  return role === 'admin';
}

export function loadServerAuth(env: Record<string, string | undefined>): ServerAuth | null {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const supabaseUrl = (env.SUPABASE_URL?.trim() || PUBLIC_SUPABASE_URL).replace(/\/$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() || PUBLIC_SUPABASE_ANON_KEY;
  if (!serviceRoleKey || serviceRoleKey.length < 20) return null;
  if (serviceRoleKey === supabaseAnonKey || serviceRoleKey === PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { supabaseUrl, supabaseAnonKey, serviceRoleKey };
}

export async function authorizeSupabaseAdmin(
  auth: ServerAuth,
  accessToken: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403 | 503 }> {
  const reader = createClient(auth.supabaseUrl, auth.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userResult = await reader.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) return { ok: false, status: 401 };
  const admin = createClient(auth.supabaseUrl, auth.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profile = await admin.from('profiles').select('role').eq('user_id', userResult.data.user.id).maybeSingle();
  if (profile.error) return { ok: false, status: 503 };
  if (!isAdminRole(profile.data?.role)) return { ok: false, status: 403 };
  return { ok: true, userId: userResult.data.user.id };
}

function current() {
  if (!service) service = build(loaded, authEnv);
  return service;
}

function build(
  configResult: ReturnType<typeof loadTelegramConfig>,
  auth: ServerAuth | null,
): ReturnType<typeof createTelegramService> {
  const config = configResult.ok ? configResult.config : null;
  const admin = config ? serviceClient(config) : null;
  const business = admin ? createSupabaseBusiness(admin) : null;
  return createTelegramService({
    config,
    disabledReasons: configResult.ok ? [] : configResult.reasons,
    store: admin ? createSupabaseTelegramStore(admin) : createMemoryTelegramStore(),
    telegram: config ? createTelegramClient(config.botToken) : disabledTelegramClient(),
    authorizeAdmin: (accessToken) =>
      auth ? authorizeSupabaseAdmin(auth, accessToken) : Promise.resolve({ ok: false, status: 503 }),
    now: () => Date.now(),
    loadBusinessRecord: (kind, recordKey) => (business ? business.load(kind, recordKey) : Promise.resolve(null)),
    listRecentBusiness: () => (business ? business.listRecent() : Promise.resolve([])),
    readPublishedRate: () => (business ? business.readRate() : Promise.resolve(null)),
  });
}

function serviceClient(config: TelegramConfig) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
