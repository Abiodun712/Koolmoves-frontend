import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { COSEALG, isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { webAuthnBytes } from './bytes.js';
import { deviceLabelFrom, displayNameFrom } from './text.js';
import type { PasskeyStore, PublicCredential } from './store.js';
import { PasskeyStorageError } from './store.js';
import type { IssuedSession, SessionIssueResult } from './sessionIssuer.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_CHALLENGE_LIMIT = 8;
const REGISTRATION_CHALLENGE_LIMIT = 5;
const MAX_CREDENTIALS = 10;
const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,512}$/;
const TRANSPORTS = new Set(['internal', 'hybrid', 'usb', 'nfc', 'ble', 'smart-card']);

export type PasskeyAccount = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  banned: boolean;
  displayName: string;
};

export interface AccountLookup {
  fromAccessToken(accessToken: string): Promise<PasskeyAccount | null>;
}

export interface SessionIssuer {
  issueForUser(userId: string): Promise<SessionIssueResult>;
}

export type PasskeyFailure =
  | 'rate_limited'
  | 'too_many_passkeys'
  | 'invalid_request'
  | 'verification_failed'
  | 'user_verification_required'
  | 'unauthorized'
  | 'unconfirmed'
  | 'storage_unavailable';

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: PasskeyFailure };

export type RelyingParty = {
  rpId: string;
  rpName: string;
  origins: string[];
};

export function createPasskeyService(deps: {
  rp: RelyingParty;
  store: PasskeyStore;
  accounts: AccountLookup;
  sessions: SessionIssuer;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    authenticationOptions(ipHash: string) {
      return run(() => createAuthenticationOptions(deps, now, ipHash));
    },
    authenticate(response: unknown) {
      return run(() => finishAuthentication(deps, now, response));
    },
    registrationOptions(accessToken: string, deviceLabel: unknown, ipHash: string) {
      return run(() => createRegistrationOptions(deps, now, accessToken, deviceLabel, ipHash));
    },
    register(accessToken: string, response: unknown) {
      return run(() => finishRegistration(deps, now, accessToken, response));
    },
    list(accessToken: string) {
      return run(() => listCredentials(deps, accessToken));
    },
    revoke(accessToken: string, credentialRecordId: unknown) {
      return run(() => revokeCredential(deps, accessToken, credentialRecordId));
    },
  };
}

async function run<T>(work: () => Promise<Ok<T> | Err>): Promise<Ok<T> | Err> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PasskeyStorageError) return { ok: false, error: 'storage_unavailable' };
    throw error;
  }
}

async function createAuthenticationOptions(
  deps: { rp: RelyingParty; store: PasskeyStore },
  now: () => Date,
  ipHash: string,
): Promise<Ok<PublicKeyCredentialRequestOptionsJSON> | Err> {
  const current = now();
  await deps.store.deleteExpiredChallenges(current.toISOString());
  const since = new Date(current.getTime() - RATE_WINDOW_MS).toISOString();
  const recent = await deps.store.countRecentChallenges({
    kind: 'authentication',
    sinceIso: since,
    ipHash,
  });
  if (recent >= AUTH_CHALLENGE_LIMIT) return { ok: false, error: 'rate_limited' };

  const options = await generateAuthenticationOptions({
    rpID: deps.rp.rpId,
    userVerification: 'required',
    timeout: 60_000,
  });
  await deps.store.insertChallenge({
    challenge: options.challenge,
    kind: 'authentication',
    userId: null,
    expiresAt: new Date(current.getTime() + CHALLENGE_TTL_MS).toISOString(),
    ipHash,
    deviceLabel: 'This device',
    createdAt: current.toISOString(),
  });
  return { ok: true, value: options };
}

async function finishAuthentication(
  deps: {
    rp: RelyingParty;
    store: PasskeyStore;
    sessions: SessionIssuer;
  },
  now: () => Date,
  response: unknown,
): Promise<Ok<IssuedSession> | Err> {
  const assertion = asAuthenticationResponse(response);
  if (!assertion) return { ok: false, error: 'invalid_request' };
  const stored = await deps.store.findCredentialByCredentialId(assertion.id);
  if (!stored) {
    await burnAuthenticationChallenge(deps.store, assertion);
    return { ok: false, error: 'verification_failed' };
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: (challenge) =>
        consume(deps.store, challenge, 'authentication', null),
      expectedOrigin: deps.rp.origins,
      expectedRPID: deps.rp.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: webAuthnBytes(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
    });
  } catch (error) {
    return { ok: false, error: failureFromWebAuthn(error) };
  }

  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    return { ok: false, error: 'verification_failed' };
  }
  if (!userHandleMatches(assertion.response.userHandle, stored.userHandle)) {
    return { ok: false, error: 'verification_failed' };
  }

  const updated = await deps.store.updateCounter({
    credentialId: stored.credentialId,
    previous: stored.counter,
    next: verification.authenticationInfo.newCounter,
    lastUsedAt: now().toISOString(),
  });
  if (!updated) return { ok: false, error: 'verification_failed' };

  const issued = await deps.sessions.issueForUser(stored.userId);
  if (!issued.ok) return { ok: false, error: 'verification_failed' };
  return { ok: true, value: issued.session };
}

async function createRegistrationOptions(
  deps: {
    rp: RelyingParty;
    store: PasskeyStore;
    accounts: AccountLookup;
  },
  now: () => Date,
  accessToken: string,
  deviceLabel: unknown,
  ipHash: string,
): Promise<Ok<PublicKeyCredentialCreationOptionsJSON> | Err> {
  const account = await requireAccount(deps.accounts, accessToken);
  if (!account.ok) return account;
  const current = now();
  await deps.store.deleteExpiredChallenges(current.toISOString());
  const since = new Date(current.getTime() - RATE_WINDOW_MS).toISOString();
  const recent = await deps.store.countRecentChallenges({
    kind: 'registration',
    sinceIso: since,
    userId: account.value.id,
  });
  if (recent >= REGISTRATION_CHALLENGE_LIMIT) return { ok: false, error: 'rate_limited' };
  const existingCount = await deps.store.countCredentials(account.value.id);
  if (existingCount >= MAX_CREDENTIALS) return { ok: false, error: 'too_many_passkeys' };

  const existing = await deps.store.listCredentialIds(account.value.id);
  const options = await generateRegistrationOptions({
    rpName: deps.rp.rpName,
    rpID: deps.rp.rpId,
    userID: isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(account.value.id)),
    userName: account.value.email,
    userDisplayName: displayNameFrom(account.value.displayName, account.value.email),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
    preferredAuthenticatorType: 'localDevice',
    supportedAlgorithmIDs: [COSEALG.ES256],
    timeout: 60_000,
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports.filter((transport) => TRANSPORTS.has(transport)),
    })),
  });
  await deps.store.insertChallenge({
    challenge: options.challenge,
    kind: 'registration',
    userId: account.value.id,
    expiresAt: new Date(current.getTime() + CHALLENGE_TTL_MS).toISOString(),
    ipHash,
    deviceLabel: deviceLabelFrom(deviceLabel),
    createdAt: current.toISOString(),
  });
  return { ok: true, value: options };
}

async function finishRegistration(
  deps: {
    rp: RelyingParty;
    store: PasskeyStore;
    accounts: AccountLookup;
  },
  now: () => Date,
  accessToken: string,
  response: unknown,
): Promise<Ok<PublicCredential> | Err> {
  const account = await requireAccount(deps.accounts, accessToken);
  if (!account.ok) return account;
  const attestation = asRegistrationResponse(response);
  if (!attestation) return { ok: false, error: 'invalid_request' };
  if ((await deps.store.countCredentials(account.value.id)) >= MAX_CREDENTIALS) {
    return { ok: false, error: 'too_many_passkeys' };
  }

  let deviceLabel = 'This device';
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: async (challenge) => {
        const row = await deps.store.consumeChallenge({
          challenge,
          kind: 'registration',
          userId: account.value.id,
        });
        if (!row) return false;
        deviceLabel = row.deviceLabel;
        return true;
      },
      expectedOrigin: deps.rp.origins,
      expectedRPID: deps.rp.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: [COSEALG.ES256],
    });
  } catch (error) {
    return { ok: false, error: failureFromWebAuthn(error) };
  }

  if (!verification.verified || !verification.registrationInfo?.userVerified) {
    return { ok: false, error: 'verification_failed' };
  }
  const credential = verification.registrationInfo.credential;
  if (credential.id !== attestation.id) return { ok: false, error: 'verification_failed' };
  const createdAt = now().toISOString();
  const id = crypto.randomUUID();
  const inserted = await deps.store.insertCredential({
    id,
    userId: account.value.id,
    credentialId: credential.id,
    publicKey: webAuthnBytes(credential.publicKey),
    counter: credential.counter,
    transports: (credential.transports ?? []).filter((transport) => TRANSPORTS.has(transport)),
    deviceLabel,
    userHandle: isoBase64URL.fromUTF8String(account.value.id),
    createdAt,
  });
  if (inserted === 'exists') return { ok: false, error: 'verification_failed' };
  return {
    ok: true,
    value: { id, deviceLabel, createdAt, lastUsedAt: null },
  };
}

async function listCredentials(
  deps: { store: PasskeyStore; accounts: AccountLookup },
  accessToken: string,
): Promise<Ok<PublicCredential[]> | Err> {
  const account = await requireAccount(deps.accounts, accessToken);
  if (!account.ok) return account;
  const credentials = await deps.store.listPublicCredentials(account.value.id);
  return { ok: true, value: credentials };
}

async function revokeCredential(
  deps: { store: PasskeyStore; accounts: AccountLookup },
  accessToken: string,
  credentialRecordId: unknown,
): Promise<Ok<{ deleted: true }> | Err> {
  const account = await requireAccount(deps.accounts, accessToken);
  if (!account.ok) return account;
  if (typeof credentialRecordId !== 'string' || !USER_ID.test(credentialRecordId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const deleted = await deps.store.deleteCredential(account.value.id, credentialRecordId);
  if (!deleted) return { ok: false, error: 'verification_failed' };
  return { ok: true, value: { deleted: true } };
}

async function requireAccount(
  accounts: AccountLookup,
  accessToken: string,
): Promise<Ok<PasskeyAccount> | Err> {
  if (!accessToken) return { ok: false, error: 'unauthorized' };
  const account = await accounts.fromAccessToken(accessToken);
  if (!account || !USER_ID.test(account.id)) return { ok: false, error: 'unauthorized' };
  if (!account.emailConfirmed || account.banned) return { ok: false, error: 'unconfirmed' };
  return { ok: true, value: account };
}

async function consume(
  store: PasskeyStore,
  challenge: string,
  kind: 'registration' | 'authentication',
  userId: string | null,
): Promise<boolean> {
  const row = await store.consumeChallenge({ challenge, kind, userId });
  return row !== null;
}

async function burnAuthenticationChallenge(
  store: PasskeyStore,
  assertion: AuthenticationResponseJSON,
): Promise<void> {
  try {
    const bytes = isoBase64URL.toBuffer(assertion.response.clientDataJSON);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(parsed) || typeof parsed.challenge !== 'string') return;
    await store.consumeChallenge({
      challenge: parsed.challenge,
      kind: 'authentication',
      userId: null,
    });
  } catch {
    // A malformed clientDataJSON cannot be replayed as a signed assertion.
  }
}

function userHandleMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return true;
  return presented === expected;
}

function failureFromWebAuthn(error: unknown): 'user_verification_required' | 'verification_failed' {
  const message = error instanceof Error ? error.message : '';
  if (/user (could not be verified|verification was required)/i.test(message)) {
    return 'user_verification_required';
  }
  return 'verification_failed';
}

function asAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null {
  if (!isRecord(value) || value.type !== 'public-key') return null;
  if (typeof value.id !== 'string' || !CREDENTIAL_ID.test(value.id) || value.rawId !== value.id) {
    return null;
  }
  if (!isRecord(value.response)) return null;
  const response = value.response;
  if (
    typeof response.clientDataJSON !== 'string' ||
    typeof response.authenticatorData !== 'string' ||
    typeof response.signature !== 'string'
  ) {
    return null;
  }
  const userHandle = response.userHandle;
  if (userHandle !== undefined && typeof userHandle !== 'string') return null;
  return {
    id: value.id,
    rawId: value.id,
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment:
      value.authenticatorAttachment === 'platform' || value.authenticatorAttachment === 'cross-platform'
        ? value.authenticatorAttachment
        : undefined,
    response: {
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      userHandle: typeof userHandle === 'string' ? userHandle : undefined,
    },
  };
}

function asRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  if (!isRecord(value) || value.type !== 'public-key') return null;
  if (typeof value.id !== 'string' || !CREDENTIAL_ID.test(value.id) || value.rawId !== value.id) {
    return null;
  }
  if (!isRecord(value.response) || typeof value.response.clientDataJSON !== 'string') return null;
  if (typeof value.response.attestationObject !== 'string') return null;
  const transports = Array.isArray(value.response.transports)
    ? value.response.transports.filter((transport): transport is string => typeof transport === 'string')
    : undefined;
  return {
    id: value.id,
    rawId: value.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: value.response.clientDataJSON,
      attestationObject: value.response.attestationObject,
      transports,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type PublicKeyCredentialRequestOptionsJSON = Awaited<ReturnType<typeof generateAuthenticationOptions>>;
type PublicKeyCredentialCreationOptionsJSON = Awaited<ReturnType<typeof generateRegistrationOptions>>;
