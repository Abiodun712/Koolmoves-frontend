// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPasskeyConfig } from './config';
import { PUBLIC_SUPABASE_ANON_KEY } from './publicSupabase';

const serviceRole = 'service-role-key-which-is-not-the-anon-key';

function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    PASSKEY_RP_ID: 'koolmovez.com',
    PASSKEY_RP_NAME: 'KoolMovez',
    PASSKEY_ORIGINS: 'https://koolmovez.com,https://www.koolmovez.com',
    ...overrides,
  };
}

describe('loadPasskeyConfig', () => {
  it('accepts the production domain and its www host', () => {
    const loaded = loadPasskeyConfig(env());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.rpId).toBe('koolmovez.com');
    expect(loaded.config.origins).toEqual(['https://koolmovez.com', 'https://www.koolmovez.com']);
    expect(loaded.config.serviceRoleKey).toBe(serviceRole);
  });

  it('stays off until the server env is present', () => {
    expect(loadPasskeyConfig({}).ok).toBe(false);
    expect(loadPasskeyConfig(env({ SUPABASE_SERVICE_ROLE_KEY: '' })).ok).toBe(false);
  });

  it('rejects the anon key, preview hosts, and an origin outside the relying party', () => {
    expect(loadPasskeyConfig(env({ SUPABASE_SERVICE_ROLE_KEY: PUBLIC_SUPABASE_ANON_KEY })).ok).toBe(false);
    expect(loadPasskeyConfig(env({ PASSKEY_RP_ID: 'koolmoves-git-main.vercel.app' })).ok).toBe(false);
    expect(
      loadPasskeyConfig(
        env({ PASSKEY_ORIGINS: 'https://koolmovez.com,https://koolmoves-git-main.vercel.app' }),
      ).ok,
    ).toBe(false);
    expect(loadPasskeyConfig(env({ PASSKEY_ORIGINS: 'http://koolmovez.com' })).ok).toBe(false);
    expect(loadPasskeyConfig(env({ PASSKEY_ORIGINS: 'https://example.com' })).ok).toBe(false);
  });

  it('allows localhost only as its own relying party', () => {
    const local = loadPasskeyConfig(
      env({ PASSKEY_RP_ID: 'localhost', PASSKEY_ORIGINS: 'http://localhost:5173' }),
    );
    expect(local.ok).toBe(true);
    expect(loadPasskeyConfig(env({ PASSKEY_ORIGINS: 'http://localhost:5173' })).ok).toBe(false);
  });
});

describe('passkey SQL', () => {
  it('keeps public keys server-only', () => {
    const sql = readFileSync(new URL('../../supabase/passkeys.sql', import.meta.url), 'utf8');
    expect(sql.toLowerCase()).toContain('force row level security');
    expect(sql.toLowerCase()).toContain('revoke all on table public.passkey_credentials from public, anon, authenticated');
    expect(sql.toLowerCase()).not.toContain('using (true)');
    expect(sql.toLowerCase()).not.toContain('with check (true)');
  });
});
