// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { issueSessionForUser, type SessionDirectory } from './sessionIssuer';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function directory(overrides: Partial<SessionDirectory> = {}): SessionDirectory & {
  links: number;
  exchanges: number;
} {
  const recorded = { links: 0, exchanges: 0 };
  return {
    get links() {
      return recorded.links;
    },
    get exchanges() {
      return recorded.exchanges;
    },
    async findUser(userId) {
      return {
        id: userId,
        email: 'ada@example.com',
        emailConfirmedAt: '2026-01-01T00:00:00.000Z',
        bannedUntil: null,
        anonymous: false,
      };
    },
    async createMagicLink() {
      recorded.links += 1;
      return {
        userId: USER_ID,
        tokenHash: 'hashed-token-not-for-the-browser',
        verificationType: 'magiclink' as const,
      };
    },
    async exchangeMagicLink() {
      recorded.exchanges += 1;
      return {
        userId: USER_ID,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
    },
    ...overrides,
  };
}

describe('issueSessionForUser', () => {
  it('returns only the Supabase session after the magic-link exchange', async () => {
    const users = directory();
    const issued = await issueSessionForUser(USER_ID, users);
    expect(issued).toEqual({
      ok: true,
      session: { accessToken: 'access-token', refreshToken: 'refresh-token' },
    });
    expect(JSON.stringify(issued)).not.toContain('hashed-token');
    expect(users.links).toBe(1);
    expect(users.exchanges).toBe(1);
  });

  it('does not create a link for an unconfirmed, anonymous, or banned account', async () => {
    for (const user of [
      { emailConfirmedAt: null, bannedUntil: null, anonymous: false },
      { emailConfirmedAt: '2026-01-01T00:00:00.000Z', bannedUntil: null, anonymous: true },
      {
        emailConfirmedAt: '2026-01-01T00:00:00.000Z',
        bannedUntil: '2999-01-01T00:00:00.000Z',
        anonymous: false,
      },
    ]) {
      const users = directory({
        async findUser(userId) {
          return { id: userId, email: 'ada@example.com', ...user };
        },
      });
      const issued = await issueSessionForUser(USER_ID, users);
      expect(issued.ok).toBe(false);
      expect(users.links).toBe(0);
      expect(users.exchanges).toBe(0);
    }
  });

  it('does not exchange a link that belongs to a different user or a non-magic-link result', async () => {
    const mismatch = directory({
      async createMagicLink() {
        return {
          userId: '33333333-3333-4333-8333-333333333333',
          tokenHash: 'other-hash',
          verificationType: 'magiclink',
        };
      },
    });
    expect((await issueSessionForUser(USER_ID, mismatch)).ok).toBe(false);
    expect(mismatch.exchanges).toBe(0);

    let exchanged = false;
    const missing = directory({
      async createMagicLink() {
        return null;
      },
      async exchangeMagicLink() {
        exchanged = true;
        return null;
      },
    });
    expect(await issueSessionForUser(USER_ID, missing)).toEqual({ ok: false, reason: 'mismatch' });
    expect(exchanged).toBe(false);
  });
});
