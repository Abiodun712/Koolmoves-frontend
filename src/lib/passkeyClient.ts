import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { supabase } from './supabaseClient';

export const DEVICE_UNLOCK_EXPLANATION =
  'Your fingerprint, face, and device PIN stay on this device. KoolMovez stores only a public key so it can recognize this device next time.';

export type DeviceUnlockFailure =
  | 'unsupported'
  | 'cancelled'
  | 'not_configured'
  | 'origin'
  | 'rate_limited'
  | 'verification_failed'
  | 'user_verification_required'
  | 'session_failed'
  | 'network'
  | 'unauthorized'
  | 'unconfirmed'
  | 'too_many_passkeys'
  | 'invalid_request';

export type PublicPasskey = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type ClientDeps = {
  fetchImpl: typeof fetch;
  startAuthentication: (
    optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  ) => Promise<AuthenticationResponseJSON>;
  startRegistration: (
    optionsJSON: PublicKeyCredentialCreationOptionsJSON,
  ) => Promise<RegistrationResponseJSON>;
  establishSession: (tokens: { accessToken: string; refreshToken: string }) => Promise<boolean>;
};

const SERVER_FAILURES = new Set<DeviceUnlockFailure>([
  'not_configured',
  'origin',
  'rate_limited',
  'verification_failed',
  'user_verification_required',
  'unauthorized',
  'unconfirmed',
  'too_many_passkeys',
  'invalid_request',
]);

export function deviceUnlockSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

export function deviceUnlockMessage(reason: DeviceUnlockFailure): string {
  switch (reason) {
    case 'cancelled':
      return 'Device sign-in was cancelled. You can try again or use your password.';
    case 'unsupported':
      return 'This browser cannot use fingerprint, face, or device PIN. Use your password.';
    case 'not_configured':
      return 'Device sign-in is not available yet. Use your password.';
    case 'origin':
      return 'Device sign-in only works on the KoolMovez website, not on a preview link. Use your password.';
    case 'rate_limited':
      return 'Too many device sign-in attempts. Wait a few minutes or use your password.';
    case 'user_verification_required':
      return 'Your device did not confirm it was you. Approve the prompt with your fingerprint, face, or device PIN, or use your password.';
    case 'session_failed':
      return 'KoolMovez could not start a session for this device. You are not signed in. Use your password or try again.';
    case 'network':
      return 'Device sign-in could not reach KoolMovez. Check your connection or use your password.';
    case 'unauthorized':
      return 'Sign in with your password again before changing device sign-in.';
    case 'unconfirmed':
      return 'Confirm your email and sign in with your password before adding a device.';
    case 'too_many_passkeys':
      return 'This account already has 10 devices. Remove one before adding another.';
    default:
      return 'This device could not be verified. Your fingerprint, face, and PIN never leave the device. Use your password or try again.';
  }
}

export async function signInWithDeviceUnlock(
  overrides: Partial<ClientDeps> = {},
): Promise<{ ok: true } | { ok: false; reason: DeviceUnlockFailure }> {
  if (!deviceUnlockSupported() && !overrides.startAuthentication) {
    return { ok: false, reason: 'unsupported' };
  }
  const deps = await resolveDeps(overrides);
  const started = await postJson(deps.fetchImpl, { op: 'authenticate-options' });
  if (!started.ok) return started;
  const options = requestOptions(started.value);
  if (!options) return { ok: false, reason: 'not_configured' };

  let credential: AuthenticationResponseJSON;
  try {
    credential = await deps.startAuthentication(options);
  } catch (error) {
    return { ok: false, reason: browserFailure(error) };
  }

  const verified = await postJson(deps.fetchImpl, { op: 'authenticate-verify', credential });
  if (!verified.ok) return verified;
  const tokens = sessionTokens(verified.value);
  if (!tokens) return { ok: false, reason: 'session_failed' };
  const established = await deps.establishSession(tokens);
  return established ? { ok: true } : { ok: false, reason: 'session_failed' };
}

export async function registerDeviceUnlock(
  accessToken: string,
  deviceLabel: string,
  overrides: Partial<ClientDeps> = {},
): Promise<{ ok: true; credential: PublicPasskey } | { ok: false; reason: DeviceUnlockFailure }> {
  if (!deviceUnlockSupported() && !overrides.startRegistration) {
    return { ok: false, reason: 'unsupported' };
  }
  const deps = await resolveDeps(overrides);
  const started = await postJson(deps.fetchImpl, { op: 'register-options', deviceLabel }, accessToken);
  if (!started.ok) return started;
  const options = creationOptions(started.value);
  if (!options) return { ok: false, reason: 'not_configured' };

  let credential: RegistrationResponseJSON;
  try {
    credential = await deps.startRegistration(options);
  } catch (error) {
    return { ok: false, reason: browserFailure(error) };
  }

  const verified = await postJson(deps.fetchImpl, { op: 'register-verify', credential }, accessToken);
  if (!verified.ok) return verified;
  const saved = onePasskey(verified.value);
  return saved ? { ok: true, credential: saved } : { ok: false, reason: 'verification_failed' };
}

export async function listDeviceUnlocks(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; credentials: PublicPasskey[] } | { ok: false; reason: DeviceUnlockFailure }> {
  const listed = await postJson(fetchImpl, { op: 'list' }, accessToken);
  if (!listed.ok) return listed;
  const credentials = passkeyList(listed.value);
  return credentials ? { ok: true, credentials } : { ok: false, reason: 'verification_failed' };
}

export async function revokeDeviceUnlock(
  accessToken: string,
  credentialId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: DeviceUnlockFailure }> {
  const revoked = await postJson(fetchImpl, { op: 'revoke', credentialId }, accessToken);
  if (!revoked.ok) return revoked;
  return { ok: true };
}

async function resolveDeps(overrides: Partial<ClientDeps>): Promise<ClientDeps> {
  return {
    fetchImpl: overrides.fetchImpl ?? fetch,
    startAuthentication:
      overrides.startAuthentication ??
      (async (optionsJSON) => {
        const { startAuthentication } = await import('@simplewebauthn/browser');
        return startAuthentication({ optionsJSON });
      }),
    startRegistration:
      overrides.startRegistration ??
      (async (optionsJSON) => {
        const { startRegistration } = await import('@simplewebauthn/browser');
        return startRegistration({ optionsJSON });
      }),
    establishSession: overrides.establishSession ?? establishSupabaseSession,
  };
}

async function establishSupabaseSession(tokens: { accessToken: string; refreshToken: string }): Promise<boolean> {
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  return !error && Boolean(data.session?.access_token) && Boolean(data.session?.refresh_token);
}

async function postJson(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: DeviceUnlockFailure }> {
  let response: Response;
  try {
    response = await fetchImpl('/api/passkeys', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, reason: 'not_configured' };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'not_configured' };
  }
  if (!response.ok) return { ok: false, reason: reasonFrom(parsed, response.status) };
  return { ok: true, value: parsed };
}

function reasonFrom(body: unknown, status: number): DeviceUnlockFailure {
  if (isRecord(body) && typeof body.error === 'string' && SERVER_FAILURES.has(body.error as DeviceUnlockFailure)) {
    return body.error as DeviceUnlockFailure;
  }
  if (status === 401) return 'unauthorized';
  if (status === 503) return 'not_configured';
  return 'verification_failed';
}

function requestOptions(body: unknown): PublicKeyCredentialRequestOptionsJSON | null {
  if (!isRecord(body) || !isRecord(body.options) || typeof body.options.challenge !== 'string') return null;
  return body.options as unknown as PublicKeyCredentialRequestOptionsJSON;
}

function creationOptions(body: unknown): PublicKeyCredentialCreationOptionsJSON | null {
  if (!isRecord(body) || !isRecord(body.options) || typeof body.options.challenge !== 'string') return null;
  return body.options as unknown as PublicKeyCredentialCreationOptionsJSON;
}

function sessionTokens(body: unknown): { accessToken: string; refreshToken: string } | null {
  if (!isRecord(body) || typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') return null;
  if (!body.accessToken || !body.refreshToken) return null;
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

function onePasskey(body: unknown): PublicPasskey | null {
  if (!isRecord(body)) return null;
  return asPasskey(body.credential);
}

function passkeyList(body: unknown): PublicPasskey[] | null {
  if (!isRecord(body) || !Array.isArray(body.credentials)) return null;
  const credentials: PublicPasskey[] = [];
  for (const item of body.credentials) {
    const passkey = asPasskey(item);
    if (!passkey) return null;
    credentials.push(passkey);
  }
  return credentials;
}

function asPasskey(value: unknown): PublicPasskey | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.deviceLabel !== 'string') return null;
  if (typeof value.createdAt !== 'string') return null;
  return {
    id: value.id,
    deviceLabel: value.deviceLabel,
    createdAt: value.createdAt,
    lastUsedAt: typeof value.lastUsedAt === 'string' ? value.lastUsedAt : null,
  };
}

function browserFailure(error: unknown): DeviceUnlockFailure {
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'verification_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
