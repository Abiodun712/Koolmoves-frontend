export type DirectoryUser = {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  anonymous: boolean;
};

export type MagicLink = {
  userId: string;
  tokenHash: string;
  verificationType: 'magiclink' | 'email';
};

export type ExchangedSession = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export interface SessionDirectory {
  findUser(userId: string): Promise<DirectoryUser | null>;
  createMagicLink(email: string): Promise<MagicLink | null>;
  exchangeMagicLink(
    tokenHash: string,
    verificationType: 'magiclink' | 'email',
  ): Promise<ExchangedSession | null>;
}

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
};

export type SessionIssueResult =
  | { ok: true; session: IssuedSession }
  | { ok: false; reason: 'unconfirmed' | 'banned' | 'mismatch' | 'provider' };

// Supabase Auth has no API that creates a session from an outside WebAuthn check.
// generateLink does not send email. The hashed token is exchanged on the server and
// is never returned to the browser. The browser receives only the resulting session.
export async function issueSessionForUser(
  userId: string,
  directory: SessionDirectory,
  now: Date = new Date(),
): Promise<SessionIssueResult> {
  const user = await directory.findUser(userId);
  if (!user || user.anonymous || !user.email || !user.emailConfirmedAt) {
    return { ok: false, reason: 'unconfirmed' };
  }
  if (user.bannedUntil && Date.parse(user.bannedUntil) > now.getTime()) {
    return { ok: false, reason: 'banned' };
  }
  const link = await directory.createMagicLink(user.email);
  if (!link || link.userId !== user.id || link.userId !== userId) {
    return { ok: false, reason: 'mismatch' };
  }
  const exchanged = await directory.exchangeMagicLink(link.tokenHash, link.verificationType);
  if (
    !exchanged ||
    exchanged.userId !== userId ||
    !exchanged.accessToken ||
    !exchanged.refreshToken
  ) {
    return { ok: false, reason: 'provider' };
  }
  return {
    ok: true,
    session: {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
    },
  };
}
