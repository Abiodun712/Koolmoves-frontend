import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { webAuthnBytes } from './bytes';
import type { AccountLookup, PasskeyAccount } from './service';
import type { PasskeyConfig } from './config';
import {
  issueSessionForUser,
  type DirectoryUser,
  type MagicLink,
  type SessionDirectory,
} from './sessionIssuer';
import type { SessionIssuer } from './service';
import { displayNameFrom } from './text';
import {
  PasskeyStorageError,
  type ChallengeKind,
  type CredentialDraft,
  type NewChallenge,
  type PasskeyStore,
  type PublicCredential,
  type StoredChallenge,
  type StoredCredential,
} from './store';

type ChallengeRow = {
  challenge: string;
  kind: ChallengeKind;
  user_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  ip_hash: string;
  device_label: string;
  created_at: string;
};

type CredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number | string;
  transports: string[] | null;
  device_label: string;
  user_handle: string;
  created_at: string;
  last_used_at: string | null;
};

export function createSupabasePasskeyStore(admin: SupabaseClient): PasskeyStore {
  return {
    async deleteExpiredChallenges(nowIso) {
      const { error } = await admin.from('passkey_challenges').delete().lt('expires_at', nowIso);
      if (error) throw new PasskeyStorageError();
    },
    async countRecentChallenges(filter) {
      let query = admin
        .from('passkey_challenges')
        .select('challenge', { count: 'exact', head: true })
        .eq('kind', filter.kind)
        .gte('created_at', filter.sinceIso);
      if (filter.ipHash) query = query.eq('ip_hash', filter.ipHash);
      if (filter.userId) query = query.eq('user_id', filter.userId);
      const { count, error } = await query;
      if (error) throw new PasskeyStorageError();
      return count ?? 0;
    },
    async insertChallenge(row: NewChallenge) {
      const { error } = await admin.from('passkey_challenges').insert(toChallengeInsert(row));
      if (error) throw new PasskeyStorageError();
    },
    async consumeChallenge(input) {
      let query = admin
        .from('passkey_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('challenge', input.challenge)
        .eq('kind', input.kind)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString());
      query = input.userId === null ? query.is('user_id', null) : query.eq('user_id', input.userId);
      const { data, error } = await query.select('*').maybeSingle();
      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new PasskeyStorageError();
      }
      return data ? fromChallenge(data as ChallengeRow) : null;
    },
    async countCredentials(userId) {
      const { count, error } = await admin
        .from('passkey_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw new PasskeyStorageError();
      return count ?? 0;
    },
    async listCredentialIds(userId) {
      const { data, error } = await admin
        .from('passkey_credentials')
        .select('credential_id, transports')
        .eq('user_id', userId);
      if (error) throw new PasskeyStorageError();
      return ((data ?? []) as Pick<CredentialRow, 'credential_id' | 'transports'>[]).map((row) => ({
        credentialId: row.credential_id,
        transports: row.transports ?? [],
      }));
    },
    async insertCredential(row: CredentialDraft) {
      const { error } = await admin.from('passkey_credentials').insert({
        id: row.id,
        user_id: row.userId,
        credential_id: row.credentialId,
        public_key: isoBase64URL.fromBuffer(webAuthnBytes(row.publicKey)),
        counter: row.counter,
        transports: row.transports,
        device_label: row.deviceLabel,
        user_handle: row.userHandle,
        created_at: row.createdAt,
      });
      if (error?.code === '23505') return 'exists';
      if (error) throw new PasskeyStorageError();
      return 'ok';
    },
    async findCredentialByCredentialId(credentialId) {
      const { data, error } = await admin
        .from('passkey_credentials')
        .select('*')
        .eq('credential_id', credentialId)
        .maybeSingle();
      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new PasskeyStorageError();
      }
      return data ? fromCredential(data as CredentialRow) : null;
    },
    async updateCounter(input) {
      const { data, error } = await admin
        .from('passkey_credentials')
        .update({ counter: input.next, last_used_at: input.lastUsedAt })
        .eq('credential_id', input.credentialId)
        .eq('counter', input.previous)
        .select('id')
        .maybeSingle();
      if (error) {
        if (error.code === 'PGRST116') return false;
        throw new PasskeyStorageError();
      }
      return Boolean(data);
    },
    async listPublicCredentials(userId) {
      const { data, error } = await admin
        .from('passkey_credentials')
        .select('id, device_label, created_at, last_used_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw new PasskeyStorageError();
      return ((data ?? []) as Pick<CredentialRow, 'id' | 'device_label' | 'created_at' | 'last_used_at'>[]).map(
        (row): PublicCredential => ({
          id: row.id,
          deviceLabel: row.device_label,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        }),
      );
    },
    async deleteCredential(userId, id) {
      const { data, error } = await admin
        .from('passkey_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('id', id)
        .select('id');
      if (error) throw new PasskeyStorageError();
      return Array.isArray(data) && data.length === 1;
    },
  };
}

export function createSupabaseAccountLookup(
  anon: SupabaseClient,
  serviceRoleKey: string,
): AccountLookup {
  return {
    async fromAccessToken(accessToken) {
      if (!accessToken || accessToken === serviceRoleKey) return null;
      const { data, error } = await anon.auth.getUser(accessToken);
      const user = data.user;
      if (error || !user?.id || !user.email) return null;
      const metadata = user.user_metadata;
      const fullName =
        metadata && typeof metadata === 'object' && 'full_name' in metadata && typeof metadata.full_name === 'string'
          ? metadata.full_name
          : user.email;
      const bannedUntil = user.banned_until;
      return {
        id: user.id,
        email: user.email,
        emailConfirmed: Boolean(user.email_confirmed_at) && user.is_anonymous !== true,
        banned: typeof bannedUntil === 'string' && Number.isFinite(Date.parse(bannedUntil)) && Date.parse(bannedUntil) > Date.now(),
        displayName: displayNameFrom(fullName, user.email),
      } satisfies PasskeyAccount;
    },
  };
}

export function createSupabaseSessionDirectory(
  admin: SupabaseClient,
  createAnon: () => SupabaseClient,
): SessionDirectory {
  return {
    async findUser(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const user = data.user;
      if (error || !user) return null;
      const directoryUser: DirectoryUser = {
        id: user.id,
        email: user.email ?? '',
        emailConfirmedAt: user.email_confirmed_at ?? null,
        bannedUntil: user.banned_until ?? null,
        anonymous: user.is_anonymous === true,
      };
      return directoryUser;
    },
    async createMagicLink(email) {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const verificationType = data?.properties?.verification_type;
      const tokenHash = data?.properties?.hashed_token;
      const userId = data?.user?.id;
      if (error || !tokenHash || !userId) return null;
      const accepted = acceptedVerificationType(verificationType);
      if (!accepted) return null;
      const link: MagicLink = { userId, tokenHash, verificationType: accepted };
      return link;
    },
    async exchangeMagicLink(tokenHash, verificationType) {
      const anon = createAnon();
      const { data, error } = await anon.auth.verifyOtp({ type: verificationType, token_hash: tokenHash });
      const accessToken = data.session?.access_token;
      const refreshToken = data.session?.refresh_token;
      const userId = data.user?.id;
      if (error || !accessToken || !refreshToken || !userId) return null;
      return { userId, accessToken, refreshToken };
    },
  };
}

export function createSupabaseSessionIssuer(
  admin: SupabaseClient,
  createAnon: () => SupabaseClient,
): SessionIssuer {
  const directory = createSupabaseSessionDirectory(admin, createAnon);
  return {
    issueForUser(userId) {
      return issueSessionForUser(userId, directory);
    },
  };
}

export function createServiceClient(config: Pick<PasskeyConfig, 'supabaseUrl' | 'serviceRoleKey' | 'supabaseAnonKey'>, key: string) {
  return createClient(config.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: memoryAuthStorage(),
    },
  });
}

function memoryAuthStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

function toChallengeInsert(row: NewChallenge) {
  return {
    challenge: row.challenge,
    kind: row.kind,
    user_id: row.userId,
    expires_at: row.expiresAt,
    ip_hash: row.ipHash,
    device_label: row.deviceLabel,
    created_at: row.createdAt,
  };
}

function fromChallenge(row: ChallengeRow): StoredChallenge {
  return {
    challenge: row.challenge,
    kind: row.kind,
    userId: row.user_id,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    ipHash: row.ip_hash,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
  };
}

function fromCredential(row: CredentialRow): StoredCredential | null {
  const counter = asCounter(row.counter);
  if (counter === null) return null;
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: webAuthnBytes(isoBase64URL.toBuffer(row.public_key)),
    counter,
    transports: row.transports ?? [],
    deviceLabel: row.device_label,
    userHandle: row.user_handle,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function acceptedVerificationType(value: string | null | undefined): 'magiclink' | 'email' | null {
  if (value === 'magiclink' || value === 'email') return value;
  return null;
}

function asCounter(value: number | string): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}
