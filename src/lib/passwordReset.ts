import { MIN_PASSWORD_LENGTH } from './passwordPolicy';
import {
  getCapturedCallback,
  restoreRecoveryTokenHash,
  takeRecoveryTokenHash,
  type RecoveryLinkKind,
} from './recoveryCallback';

export type ResetRequestPhase = 'idle' | 'submitting' | 'sent' | 'rate_limit' | 'network' | 'provider' | 'validation';

export interface ResetRequestFailure {
  type: Exclude<ResetRequestPhase, 'idle' | 'submitting' | 'sent'>;
  retryAfterSeconds: number | null;
}

const ENUMERATION_PATTERNS = [
  /user not found/,
  /email not found/,
  /no user/,
  /not registered/,
  /does not exist/,
  /doesn't exist/,
  /email address not confirmed/,
  /email not confirmed/,
  /user already registered/,
];

const TOKEN_LEAK = /access_token|refresh_token|token_hash|provider_token|bearer\s+[a-z0-9._~+/-]{8,}|eyJ[a-zA-Z0-9_-]{8,}/i;

function asRecord(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') return null;
  return error as Record<string, unknown>;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  const message = record?.message;
  return typeof message === 'string' ? message : '';
}

function codeOf(error: unknown): string {
  const record = asRecord(error);
  const code = record?.code;
  return typeof code === 'string' ? code : '';
}

function statusOf(error: unknown): number | null {
  const record = asRecord(error);
  const status = record?.status;
  return typeof status === 'number' ? status : null;
}

function nameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  const record = asRecord(error);
  const name = record?.name;
  return typeof name === 'string' ? name : '';
}

function retryAfterSeconds(message: string): number | null {
  const match = /after (\d+) seconds?/.exec(message.toLowerCase());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function isEnumeration(error: unknown): boolean {
  const code = codeOf(error);
  if (code === 'user_not_found' || code === 'email_not_confirmed') return true;
  const lower = messageOf(error).toLowerCase();
  return ENUMERATION_PATTERNS.some((pattern) => pattern.test(lower));
}

function isNetwork(error: unknown): boolean {
  const status = statusOf(error);
  const code = codeOf(error);
  const name = nameOf(error);
  const lower = messageOf(error).toLowerCase();
  return (
    status === 0 ||
    code === 'request_timeout' ||
    name === 'AuthRetryableFetchError' ||
    name === 'TypeError' ||
    /failed to fetch|network|timeout|load failed|offline|networkerror/.test(lower)
  );
}

function isRateLimit(error: unknown): boolean {
  const status = statusOf(error);
  const code = codeOf(error);
  const lower = messageOf(error).toLowerCase();
  return (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    /rate limit|too many requests|only request this after|for security purposes/.test(lower)
  );
}

function isInvalidEmail(error: unknown): boolean {
  const lower = messageOf(error).toLowerCase();
  return /invalid format|invalid email|unable to validate email address|email address is invalid/.test(lower);
}

export function classifyResetRequestError(error: unknown): ResetRequestFailure | null {
  if (!error) return null;
  if (isEnumeration(error)) return null;
  if (isInvalidEmail(error)) return { type: 'validation', retryAfterSeconds: null };
  if (isRateLimit(error)) return { type: 'rate_limit', retryAfterSeconds: retryAfterSeconds(messageOf(error)) };
  if (isNetwork(error)) return { type: 'network', retryAfterSeconds: null };
  return { type: 'provider', retryAfterSeconds: null };
}

export function resetRequestMessage(phase: ResetRequestPhase, email: string, retryAfterSeconds: number | null): string {
  if (phase === 'sent') {
    return `If an account exists for ${email.trim()}, we sent a password reset link. Check your inbox and spam folder. If you just created an account, confirm that email first, then request another link.`;
  }
  if (phase === 'validation') return 'Enter a valid email address.';
  if (phase === 'rate_limit') {
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      return `Too many reset requests. Please wait ${retryAfterSeconds} seconds and try again.`;
    }
    return 'Too many reset requests. Please wait a few minutes and try again.';
  }
  if (phase === 'network') return "We couldn't reach the server. Check your connection and try again.";
  if (phase === 'provider') return "We couldn't send the reset email right now. Please try again in a moment.";
  return '';
}

export type PasswordUpdatePhase =
  | 'updated'
  | 'validation'
  | 'same_password'
  | 'weak_password'
  | 'session_expired'
  | 'rate_limit'
  | 'network'
  | 'provider';

export interface PasswordUpdateFailure {
  type: Exclude<PasswordUpdatePhase, 'updated'>;
  retryAfterSeconds: number | null;
  minimumLength?: number;
}

export function classifyPasswordUpdateError(error: unknown): PasswordUpdateFailure {
  const code = codeOf(error);
  const status = statusOf(error);
  const lower = messageOf(error).toLowerCase();

  if (TOKEN_LEAK.test(messageOf(error))) return { type: 'provider', retryAfterSeconds: null };
  if (code === 'same_password' || /different from the old password|should be different from/.test(lower)) {
    return { type: 'same_password', retryAfterSeconds: null };
  }
  if (code === 'weak_password' || /weak and easy to guess|known to be weak|pwned|leaked/.test(lower)) {
    return { type: 'weak_password', retryAfterSeconds: null };
  }
  const minimumMatch = /at least (\d+) characters/.exec(lower);
  if (minimumMatch) {
    return { type: 'validation', retryAfterSeconds: null, minimumLength: Number(minimumMatch[1]) };
  }
  if (
    status === 401 ||
    code === 'session_not_found' ||
    nameOf(error) === 'AuthSessionMissingError' ||
    /auth session missing|session expired|session not found|session is missing/.test(lower)
  ) {
    return { type: 'session_expired', retryAfterSeconds: null };
  }
  if (isRateLimit(error)) return { type: 'rate_limit', retryAfterSeconds: retryAfterSeconds(lower) };
  if (isNetwork(error)) return { type: 'network', retryAfterSeconds: null };
  return { type: 'provider', retryAfterSeconds: null };
}

export function passwordUpdateMessage(failure: PasswordUpdateFailure): string {
  switch (failure.type) {
    case 'validation':
      return `Password must be at least ${failure.minimumLength ?? MIN_PASSWORD_LENGTH} characters long.`;
    case 'same_password':
      return 'Choose a password that is different from your current one.';
    case 'weak_password':
      return 'That password is too easy to guess. Choose a different one.';
    case 'session_expired':
      return 'This reset session has expired. Request a new reset link.';
    case 'rate_limit':
      return failure.retryAfterSeconds
        ? `Too many attempts. Please wait ${failure.retryAfterSeconds} seconds and try again.`
        : 'Too many attempts. Please wait a moment and try again.';
    case 'network':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'provider':
      return "We couldn't update your password. Please try again.";
    default:
      return "We couldn't update your password. Please try again.";
  }
}

export function recoveryProblemMessage(kind: RecoveryLinkKind): string {
  switch (kind) {
    case 'missing':
      return 'This reset link is missing required information. Request a new link.';
    case 'invalid':
      return 'This reset link is invalid. Request a new one.';
    case 'expired':
      return 'This reset link has expired. Request a new one.';
    case 'reused':
      return 'This reset link was already used. Request a new one.';
    case 'invalid_or_expired':
      return 'This reset link is invalid or has expired. It may also have already been used. Request a new one.';
    case 'provider':
      return "We couldn't verify this reset link. Request a new one.";
    case 'none':
      return 'Open the password reset link from your email, or request a new one.';
    default:
      return 'Open the password reset link from your email, or request a new one.';
  }
}

export function passwordResetRedirectTo(origin: string): string {
  return new URL('/reset-password', origin).toString();
}

export function postResetPath(role: string | null | undefined): '/admin' | '/home' {
  return role === 'admin' ? '/admin' : '/home';
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return `${parts[0].slice(0, 1)}***@${parts[1]}`;
}

export type RecoveryVerification =
  | { ok: true }
  | { ok: false; kind: RecoveryLinkKind; network: boolean };

let recoveryVerification: Promise<RecoveryVerification> | null = null;

export function beginRecoveryVerification(
  verify: (tokenHash: string) => Promise<{ error: unknown }>,
): Promise<RecoveryVerification> | null {
  if (getCapturedCallback().kind !== 'token_hash') return null;
  if (!recoveryVerification) {
    recoveryVerification = verifyCapturedTokenHash(verify);
  }
  return recoveryVerification;
}

async function verifyCapturedTokenHash(
  verify: (tokenHash: string) => Promise<{ error: unknown }>,
): Promise<RecoveryVerification> {
  const tokenHash = takeRecoveryTokenHash();
  if (!tokenHash) return { ok: false, kind: 'missing', network: false };
  try {
    const { error } = await verify(tokenHash);
    if (!error) return { ok: true };
    return failureFromVerify(error, tokenHash);
  } catch (error) {
    return failureFromVerify(error, tokenHash);
  }
}

function failureFromVerify(error: unknown, tokenHash: string): RecoveryVerification {
  const failure = classifyPasswordUpdateError(error);
  if (failure.type === 'network') {
    restoreRecoveryTokenHash(tokenHash);
    recoveryVerification = null;
    return { ok: false, kind: 'provider', network: true };
  }
  return { ok: false, kind: verifyFailureKind(error), network: false };
}

function verifyFailureKind(error: unknown): RecoveryLinkKind {
  const code = codeOf(error);
  const description = messageOf(error);
  const lower = description.toLowerCase();
  if (/already been used|already used|previously used|been used|reused/.test(lower)) return 'reused';
  if (/expired/.test(lower) && /invalid/.test(lower)) return 'invalid_or_expired';
  if (/expired/.test(lower)) return 'expired';
  if (/invalid/.test(lower)) return 'invalid';
  if (code === 'otp_expired' || code === 'flow_state_expired') return 'invalid_or_expired';
  if (!description) return 'missing';
  return 'provider';
}

export function resetRecoveryVerificationForTests(): void {
  recoveryVerification = null;
}
