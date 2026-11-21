import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from './publicSupabase';
import { stripControls } from './text';

export type PasskeyConfig = {
  rpId: string;
  rpName: string;
  origins: string[];
  supabaseUrl: string;
  supabaseAnonKey: string;
  serviceRoleKey: string;
};

export type PasskeyConfigFailure = 'missing' | 'invalid';

const MAX_ORIGINS = 5;

export function loadPasskeyConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: PasskeyConfig } | { ok: false; reason: PasskeyConfigFailure } {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const rpId = env.PASSKEY_RP_ID?.trim() ?? '';
  const rpName = cleanRpName(env.PASSKEY_RP_NAME);
  const originsRaw = env.PASSKEY_ORIGINS?.trim() ?? '';
  const supabaseUrl = (env.SUPABASE_URL?.trim() || PUBLIC_SUPABASE_URL).replace(/\/$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() || PUBLIC_SUPABASE_ANON_KEY;

  if (!serviceRoleKey || !rpId || !originsRaw) {
    return { ok: false, reason: 'missing' };
  }
  if (
    serviceRoleKey === supabaseAnonKey ||
    serviceRoleKey === PUBLIC_SUPABASE_ANON_KEY ||
    serviceRoleKey.length < 20
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (!isRpId(rpId) || !isHttpsUrl(supabaseUrl)) {
    return { ok: false, reason: 'invalid' };
  }

  const origins = originsRaw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length < 1 || origins.length > MAX_ORIGINS) {
    return { ok: false, reason: 'invalid' };
  }
  const normalized: string[] = [];
  for (const origin of origins) {
    const next = normalizeOrigin(origin, rpId);
    if (!next || normalized.includes(next)) return { ok: false, reason: 'invalid' };
    normalized.push(next);
  }

  return {
    ok: true,
    config: {
      rpId,
      rpName,
      origins: normalized,
      supabaseUrl,
      supabaseAnonKey,
      serviceRoleKey,
    },
  };
}

function cleanRpName(value: string | undefined): string {
  const cleaned = stripControls(value ?? '').trim().slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'KoolMovez';
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isRpId(rpId: string): boolean {
  if (rpId !== rpId.toLowerCase() || rpId.length > 253) return false;
  if (rpId === 'localhost') return true;
  if (!/^[a-z0-9.-]+$/.test(rpId)) return false;
  if (rpId.startsWith('.') || rpId.endsWith('.') || rpId.includes('..') || !rpId.includes('.')) return false;
  if (isPreviewHost(rpId)) return false;
  return true;
}

function isPreviewHost(host: string): boolean {
  return host === 'vercel.app' || host.endsWith('.vercel.app');
}

function normalizeOrigin(value: string, rpId: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  const host = url.hostname.toLowerCase();
  if (isPreviewHost(host)) return null;
  if (rpId === 'localhost') {
    if (host !== 'localhost' || url.protocol !== 'http:') return null;
    return url.origin;
  }
  if (url.protocol !== 'https:') return null;
  if (host !== rpId && !host.endsWith(`.${rpId}`)) return null;
  return url.origin;
}
