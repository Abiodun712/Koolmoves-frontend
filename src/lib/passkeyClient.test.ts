import { describe, expect, it, vi } from 'vitest';
import { signInWithDeviceUnlock, registerDeviceUnlock } from './passkeyClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('signInWithDeviceUnlock', () => {
  it('does not save a session when the browser check is cancelled', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ options: { challenge: 'abc' } }));
    const establishSession = vi.fn(async () => true);
    const result = await signInWithDeviceUnlock({
      fetchImpl,
      startAuthentication: async () => {
        const error = new Error('cancelled');
        error.name = 'NotAllowedError';
        throw error;
      },
      establishSession,
    });
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(establishSession).not.toHaveBeenCalled();
  });

  it('does not save a session when the server omits session tokens', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.op === 'authenticate-options') return jsonResponse({ options: { challenge: 'abc' } });
      return jsonResponse({ verified: true });
    });
    const establishSession = vi.fn(async () => true);
    const result = await signInWithDeviceUnlock({
      fetchImpl,
      startAuthentication: async () => ({
        id: 'cred',
        rawId: 'cred',
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30' },
      }),
      establishSession,
    });
    expect(result).toEqual({ ok: false, reason: 'session_failed' });
    expect(establishSession).not.toHaveBeenCalled();
  });

  it('saves a session only from the tokens the server returns', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.op === 'authenticate-options') return jsonResponse({ options: { challenge: 'abc' } });
      return jsonResponse({ accessToken: 'access', refreshToken: 'refresh' });
    });
    const establishSession = vi.fn(async () => true);
    const result = await signInWithDeviceUnlock({
      fetchImpl,
      startAuthentication: async () => ({
        id: 'cred',
        rawId: 'cred',
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30' },
      }),
      establishSession,
    });
    expect(result).toEqual({ ok: true });
    expect(establishSession).toHaveBeenCalledWith({ accessToken: 'access', refreshToken: 'refresh' });
  });

  it('treats an HTML rewrite as unavailable and does not prompt the device', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    const startAuthentication = vi.fn();
    const result = await signInWithDeviceUnlock({ fetchImpl, startAuthentication });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
    expect(startAuthentication).not.toHaveBeenCalled();
  });
});

describe('registerDeviceUnlock', () => {
  it('does not send a credential when the prompt is cancelled', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ options: { challenge: 'abc' } }));
    const result = await registerDeviceUnlock('token-token-token-token', 'Phone', {
      fetchImpl,
      startRegistration: async () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      },
    });
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
