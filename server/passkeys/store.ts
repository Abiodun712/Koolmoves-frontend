export type ChallengeKind = 'registration' | 'authentication';

export type StoredChallenge = {
  challenge: string;
  kind: ChallengeKind;
  userId: string | null;
  expiresAt: string;
  consumedAt: string | null;
  ipHash: string;
  deviceLabel: string;
  createdAt: string;
};

export type NewChallenge = {
  challenge: string;
  kind: ChallengeKind;
  userId: string | null;
  expiresAt: string;
  ipHash: string;
  deviceLabel: string;
  createdAt: string;
};

export type StoredCredential = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceLabel: string;
  userHandle: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PublicCredential = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type CredentialDraft = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceLabel: string;
  userHandle: string;
  createdAt: string;
};

export class PasskeyStorageError extends Error {
  constructor() {
    super('passkey storage unavailable');
    this.name = 'PasskeyStorageError';
  }
}

export interface PasskeyStore {
  deleteExpiredChallenges(nowIso: string): Promise<void>;
  countRecentChallenges(filter: {
    kind: ChallengeKind;
    sinceIso: string;
    ipHash?: string;
    userId?: string;
  }): Promise<number>;
  insertChallenge(row: NewChallenge): Promise<void>;
  consumeChallenge(input: {
    challenge: string;
    kind: ChallengeKind;
    userId: string | null;
  }): Promise<StoredChallenge | null>;
  countCredentials(userId: string): Promise<number>;
  listCredentialIds(userId: string): Promise<{ credentialId: string; transports: string[] }[]>;
  insertCredential(row: CredentialDraft): Promise<'ok' | 'exists'>;
  findCredentialByCredentialId(credentialId: string): Promise<StoredCredential | null>;
  updateCounter(input: {
    credentialId: string;
    previous: number;
    next: number;
    lastUsedAt: string;
  }): Promise<boolean>;
  listPublicCredentials(userId: string): Promise<PublicCredential[]>;
  deleteCredential(userId: string, id: string): Promise<boolean>;
}

export function createMemoryPasskeyStore(options?: { now?: () => Date }): PasskeyStore {
  const challenges: StoredChallenge[] = [];
  const credentials: StoredCredential[] = [];
  const now = options?.now ?? (() => new Date());

  return {
    async deleteExpiredChallenges(nowIso) {
      for (let index = challenges.length - 1; index >= 0; index -= 1) {
        const challenge = challenges[index];
        if (challenge && challenge.expiresAt <= nowIso) challenges.splice(index, 1);
      }
    },
    async countRecentChallenges(filter) {
      return challenges.filter((challenge) => {
        if (challenge.kind !== filter.kind || challenge.createdAt < filter.sinceIso) return false;
        if (filter.ipHash && challenge.ipHash !== filter.ipHash) return false;
        if (filter.userId && challenge.userId !== filter.userId) return false;
        return true;
      }).length;
    },
    async insertChallenge(row) {
      challenges.push({ ...row, consumedAt: null });
    },
    async consumeChallenge(input) {
      const challenge = challenges.find(
        (row) =>
          row.challenge === input.challenge &&
          row.kind === input.kind &&
          row.userId === input.userId &&
          row.consumedAt === null &&
          row.expiresAt > now().toISOString(),
      );
      if (!challenge) return null;
      challenge.consumedAt = new Date().toISOString();
      return { ...challenge };
    },
    async countCredentials(userId) {
      return credentials.filter((row) => row.userId === userId).length;
    },
    async listCredentialIds(userId) {
      return credentials
        .filter((row) => row.userId === userId)
        .map((row) => ({ credentialId: row.credentialId, transports: [...row.transports] }));
    },
    async insertCredential(row) {
      if (credentials.some((existing) => existing.credentialId === row.credentialId)) return 'exists';
      credentials.push({
        ...row,
        publicKey: new Uint8Array(row.publicKey),
        transports: [...row.transports],
        lastUsedAt: null,
      });
      return 'ok';
    },
    async findCredentialByCredentialId(credentialId) {
      const row = credentials.find((credential) => credential.credentialId === credentialId);
      if (!row) return null;
      return { ...row, publicKey: new Uint8Array(row.publicKey), transports: [...row.transports] };
    },
    async updateCounter(input) {
      const row = credentials.find(
        (credential) => credential.credentialId === input.credentialId && credential.counter === input.previous,
      );
      if (!row) return false;
      row.counter = input.next;
      row.lastUsedAt = input.lastUsedAt;
      return true;
    },
    async listPublicCredentials(userId) {
      return credentials
        .filter((row) => row.userId === userId)
        .map((row) => ({
          id: row.id,
          deviceLabel: row.deviceLabel,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
        }));
    },
    async deleteCredential(userId, id) {
      const index = credentials.findIndex((row) => row.userId === userId && row.id === id);
      if (index < 0) return false;
      credentials.splice(index, 1);
      return true;
    },
  };
}
