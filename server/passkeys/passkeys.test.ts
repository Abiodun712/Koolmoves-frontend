// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';
import { webAuthnBytes } from './bytes';
import { createPasskeyApi } from './routes';
import type { SessionIssueResult } from './sessionIssuer';
import { createPasskeyService } from './service';
import type { AccountLookup, PasskeyAccount, SessionIssuer } from './service';
import { SoftwareAuthenticator } from './softwareAuthenticator';
import { createMemoryPasskeyStore } from './store';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const RP = {
  rpId: 'koolmovez.com',
  rpName: 'KoolMovez',
  origins: ['https://koolmovez.com', 'https://www.koolmovez.com'],
};
const ORIGIN = 'https://koolmovez.com';

function account(overrides: Partial<PasskeyAccount> = {}): PasskeyAccount {
  return {
    id: USER_ID,
    email: 'ada@example.com',
    emailConfirmed: true,
    banned: false,
    displayName: 'Ada',
    ...overrides,
  };
}

function lookup(current: PasskeyAccount | null): AccountLookup {
  return {
    async fromAccessToken(token) {
      if (token === 'user-access-token') return current;
      if (token === 'other-access-token') return account({ id: OTHER_ID, email: 'other@example.com' });
      return null;
    },
  };
}

function issuer(result?: SessionIssueResult): { sessions: SessionIssuer; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sessions: {
      async issueForUser(userId) {
        calls.push(userId);
        return (
          result ?? {
            ok: true,
            session: { accessToken: `access-for-${userId}`, refreshToken: `refresh-for-${userId}` },
          }
        );
      },
    },
  };
}

function setup(current: PasskeyAccount | null = account(), sessionResult?: SessionIssueResult) {
  const store = createMemoryPasskeyStore();
  const sessions = issuer(sessionResult);
  const service = createPasskeyService({
    rp: RP,
    store,
    accounts: lookup(current),
    sessions: sessions.sessions,
  });
  const api = createPasskeyApi({
    rp: RP,
    store,
    accounts: lookup(current),
    sessions: sessions.sessions,
  });
  return { store, service, api, calls: sessions.calls };
}

function request(op: string, extra: Record<string, unknown> = {}, token?: string): Request {
  return new Request('https://koolmovez.com/api/passkeys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ op, ...extra }),
  });
}

describe('passkey ceremonies', () => {
  it('requires user verification, then asks for a session only for the stored account', async () => {
    const { service, calls, store } = setup();
    const authenticator = await SoftwareAuthenticator.create(USER_ID);
    const registration = await service.registrationOptions('user-access-token', 'Ada’s phone', 'ip');
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    expect(registration.value.authenticatorSelection?.userVerification).toBe('required');
    expect(registration.value.authenticatorSelection?.residentKey).toBe('required');
    expect(registration.value.authenticatorSelection?.authenticatorAttachment).toBe('platform');

    const registered = await service.register(
      'user-access-token',
      await authenticator.registrationResponse({
        challenge: registration.value.challenge,
        origin: ORIGIN,
        rpId: RP.rpId,
        userVerified: true,
      }),
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.value.deviceLabel).toBe('Ada’s phone');

    const stored = await service.list('user-access-token');
    expect(stored.ok && stored.value).toEqual([
      expect.objectContaining({ id: registered.value.id, deviceLabel: 'Ada’s phone' }),
    ]);

    const options = await service.authenticationOptions('ip');
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    expect(options.value.userVerification).toBe('required');
    expect(options.value.allowCredentials).toBeUndefined();
    expect(JSON.stringify(options.value)).not.toContain('@');

    const signedIn = await service.authenticate(
      await authenticator.authenticationResponse({
        challenge: options.value.challenge,
        origin: ORIGIN,
        rpId: RP.rpId,
        userVerified: true,
      }),
    );
    expect(signedIn).toEqual({
      ok: true,
      value: { accessToken: `access-for-${USER_ID}`, refreshToken: `refresh-for-${USER_ID}` },
    });
    expect(calls).toEqual([USER_ID]);

    const saved = await store.findCredentialByCredentialId(authenticator.credentialIdText);
    expect(saved).not.toBeNull();
    const decoded = decodeCredentialPublicKey(webAuthnBytes(saved?.publicKey ?? new Uint8Array())) as unknown as Map<
      number,
      unknown
    >;
    expect(decoded.get(-4)).toBeUndefined();
    const privateKey = await authenticator.exportPrivateKey();
    expect(includesBytes(saved?.publicKey ?? new Uint8Array(), privateKey)).toBe(false);
  });

  it('does not issue a session when the signed assertion skipped user verification', async () => {
    const { service, calls } = setup();
    const authenticator = await enrolled(service);
    const options = await service.authenticationOptions('ip');
    if (!options.ok) throw new Error('options');
    const result = await service.authenticate(
      await authenticator.authenticationResponse({
        challenge: options.value.challenge,
        origin: ORIGIN,
        rpId: RP.rpId,
        userVerified: false,
      }),
    );
    expect(result).toEqual({ ok: false, error: 'user_verification_required' });
    expect(calls).toEqual([]);
  });

  it('rejects a different origin, a different relying party, and a replayed assertion', async () => {
    const { service, calls } = setup();
    const authenticator = await enrolled(service);

    const wrongOrigin = await service.authenticationOptions('ip');
    if (!wrongOrigin.ok) throw new Error('options');
    expect(
      await service.authenticate(
        await authenticator.authenticationResponse({
          challenge: wrongOrigin.value.challenge,
          origin: 'https://evil.example',
          rpId: RP.rpId,
          userVerified: true,
        }),
      ),
    ).toEqual({ ok: false, error: 'verification_failed' });

    const wrongRp = await service.authenticationOptions('ip');
    if (!wrongRp.ok) throw new Error('options');
    expect(
      await service.authenticate(
        await authenticator.authenticationResponse({
          challenge: wrongRp.value.challenge,
          origin: ORIGIN,
          rpId: 'preview.vercel.app',
          userVerified: true,
        }),
      ),
    ).toEqual({ ok: false, error: 'verification_failed' });

    const options = await service.authenticationOptions('ip');
    if (!options.ok) throw new Error('options');
    const assertion = await authenticator.authenticationResponse({
      challenge: options.value.challenge,
      origin: ORIGIN,
      rpId: RP.rpId,
      userVerified: true,
    });
    expect((await service.authenticate(assertion)).ok).toBe(true);
    expect((await service.authenticate(assertion)).ok).toBe(false);
    expect(calls).toEqual([USER_ID]);
  });

  it('rejects a second assertion that reuses a signature counter', async () => {
    const { service, calls } = setup();
    const authenticator = await enrolled(service);
    const first = await service.authenticationOptions('ip');
    if (!first.ok) throw new Error('options');
    expect(
      (
        await service.authenticate(
          await authenticator.authenticationResponse({
            challenge: first.value.challenge,
            origin: ORIGIN,
            rpId: RP.rpId,
            userVerified: true,
            counter: 4,
          }),
        )
      ).ok,
    ).toBe(true);
    const second = await service.authenticationOptions('ip');
    if (!second.ok) throw new Error('options');
    expect(
      await service.authenticate(
        await authenticator.authenticationResponse({
          challenge: second.value.challenge,
          origin: ORIGIN,
          rpId: RP.rpId,
          userVerified: true,
          counter: 4,
        }),
      ),
    ).toEqual({ ok: false, error: 'verification_failed' });
    expect(calls).toEqual([USER_ID]);
  });

  it('accepts a counter that stays at zero, which synced platform keys do, once per challenge', async () => {
    const { service, calls } = setup();
    const authenticator = await enrolled(service);
    for (const expected of [1, 2]) {
      const options = await service.authenticationOptions('ip');
      if (!options.ok) throw new Error('options');
      const result = await service.authenticate(
        await authenticator.authenticationResponse({
          challenge: options.value.challenge,
          origin: ORIGIN,
          rpId: RP.rpId,
          userVerified: true,
          counter: 0,
        }),
      );
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(expected);
    }
  });

  it('does not let another signed-in account finish a registration challenge', async () => {
    const { service } = setup();
    const authenticator = await SoftwareAuthenticator.create(USER_ID);
    const options = await service.registrationOptions('user-access-token', 'Phone', 'ip');
    if (!options.ok) throw new Error('options');
    const result = await service.register(
      'other-access-token',
      await authenticator.registrationResponse({
        challenge: options.value.challenge,
        origin: ORIGIN,
        rpId: RP.rpId,
        userVerified: true,
      }),
    );
    expect(result).toEqual({ ok: false, error: 'verification_failed' });
    const listed = await service.list('other-access-token');
    expect(listed.ok && listed.value).toEqual([]);
  });

  it('refuses registration without a confirmed account and refuses a mismatched user handle', async () => {
    const unconfirmed = setup(account({ emailConfirmed: false }));
    expect(await unconfirmed.service.registrationOptions('user-access-token', 'Phone', 'ip')).toEqual({
      ok: false,
      error: 'unconfirmed',
    });

    const { service, calls } = setup();
    const authenticator = await enrolled(service);
    const options = await service.authenticationOptions('ip');
    if (!options.ok) throw new Error('options');
    expect(
      await service.authenticate(
        await authenticator.authenticationResponse({
          challenge: options.value.challenge,
          origin: ORIGIN,
          rpId: RP.rpId,
          userVerified: true,
          userHandle: new TextEncoder().encode('someone-else'),
        }),
      ),
    ).toEqual({ ok: false, error: 'verification_failed' });
    expect(calls).toEqual([]);
  });

  it('does not issue a session when Supabase will not mint one', async () => {
    const { service, calls } = setup(account(), { ok: false, reason: 'unconfirmed' });
    const authenticator = await enrolled(service);
    const options = await service.authenticationOptions('ip');
    if (!options.ok) throw new Error('options');
    const result = await service.authenticate(
      await authenticator.authenticationResponse({
        challenge: options.value.challenge,
        origin: ORIGIN,
        rpId: RP.rpId,
        userVerified: true,
      }),
    );
    expect(result).toEqual({ ok: false, error: 'verification_failed' });
    expect(calls).toEqual([USER_ID]);
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('keeps the HTTP response free of session tokens unless verification succeeded', async () => {
    const { api } = setup();
    const authenticator = await SoftwareAuthenticator.create(USER_ID);
    const optionsResponse = await api.fetch(request('authenticate-options'));
    expect(optionsResponse.headers.get('cache-control')).toBe('no-store');
    const optionsBody = (await optionsResponse.json()) as { options: { challenge: string } };
    const failed = await api.fetch(
      request('authenticate-verify', {
        credential: await authenticator.authenticationResponse({
          challenge: optionsBody.options.challenge,
          origin: ORIGIN,
          rpId: RP.rpId,
          userVerified: true,
        }),
        userId: OTHER_ID,
      }),
    );
    const failedBody = await failed.json();
    expect(failed.status).toBe(400);
    expect(failedBody).toEqual({ error: 'verification_failed' });
    expect(JSON.stringify(failedBody)).not.toContain('accessToken');

    const preview = await api.fetch(
      new Request('https://koolmoves-git-preview.vercel.app/api/passkeys', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://koolmoves-git-preview.vercel.app',
        },
        body: JSON.stringify({ op: 'authenticate-options' }),
      }),
    );
    expect(await preview.json()).toEqual({ error: 'origin' });

    expect(await (await api.fetch(request('register-options'))).json()).toEqual({ error: 'unauthorized' });
  });

  it('limits how many sign-in challenges one address can collect', async () => {
    const { service } = setup();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await service.authenticationOptions('same-ip')).ok).toBe(true);
    }
    expect(await service.authenticationOptions('same-ip')).toEqual({ ok: false, error: 'rate_limited' });
    expect((await service.authenticationOptions('other-ip')).ok).toBe(true);
  });

  it('revokes only the signed-in account’s credential and leaves password login untouched', async () => {
    const { service } = setup();
    const authenticator = await enrolled(service);
    const listed = await service.list('user-access-token');
    if (!listed.ok) throw new Error('list');
    expect(await service.revoke('other-access-token', listed.value[0]?.id)).toEqual({
      ok: false,
      error: 'verification_failed',
    });
    expect((await service.revoke('user-access-token', listed.value[0]?.id)).ok).toBe(true);
    const options = await service.authenticationOptions('ip');
    if (!options.ok) throw new Error('options');
    expect(
      (
        await service.authenticate(
          await authenticator.authenticationResponse({
            challenge: options.value.challenge,
            origin: ORIGIN,
            rpId: RP.rpId,
            userVerified: true,
          }),
        )
      ).ok,
    ).toBe(false);
  });

  it('does not ship the software authenticator in the request handler', () => {
    const api = readFileSync(new URL('../../api/passkeys.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('./production.ts', import.meta.url), 'utf8');
    expect(api).not.toContain('softwareAuthenticator');
    expect(production).not.toContain('softwareAuthenticator');
    expect(production).not.toContain('generateLink');
  });
});

async function enrolled(
  service: ReturnType<typeof createPasskeyService>,
): Promise<SoftwareAuthenticator> {
  const authenticator = await SoftwareAuthenticator.create(USER_ID);
  const options = await service.registrationOptions('user-access-token', 'Phone', 'ip');
  if (!options.ok) throw new Error(options.error);
  const registered = await service.register(
    'user-access-token',
    await authenticator.registrationResponse({
      challenge: options.value.challenge,
      origin: ORIGIN,
      rpId: RP.rpId,
      userVerified: true,
    }),
  );
  if (!registered.ok) throw new Error(registered.error);
  return authenticator;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}
