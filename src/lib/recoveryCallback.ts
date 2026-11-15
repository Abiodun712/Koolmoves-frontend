/**
 * Password-recovery URL handling for the implicit-grant Supabase client.
 *
 * auth-js 2.110 defaults `flowType` to `implicit` and `detectSessionInUrl` to true.
 * `resetPasswordForEmail` therefore does not store a PKCE verifier. After the user
 * opens the email, GoTrue redirects to `redirectTo` with the session in the URL
 * fragment (`#access_token&refresh_token&type=recovery`) or, when the link is
 * rejected, with `error` / `error_code` / `error_description`. A customized
 * template may instead land on this app with `?token_hash&type=recovery`.
 *
 * Token values stay in this module long enough for the client to read them.
 * Nothing exported for rendering includes a token.
 */

export const PASSWORD_RECOVERY_FLAG = 'koolmovez.passwordRecovery';

const AUTH_QUERY_KEYS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'token',
  'token_hash',
  'code',
  'error',
  'error_code',
  'error_description',
  'type',
  'next',
] as const;

export type RecoveryLinkKind =
  | 'none'
  | 'implicit'
  | 'token_hash'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'reused'
  | 'invalid_or_expired'
  | 'provider';

export interface RecoveryLinkAssessment {
  kind: RecoveryLinkKind;
  /** Provider error code such as `otp_expired`. Never a token. */
  code: string | null;
}

const PROBLEM_KINDS = new Set<RecoveryLinkKind>([
  'missing',
  'invalid',
  'expired',
  'reused',
  'invalid_or_expired',
  'provider',
]);

export function isRecoveryProblem(kind: RecoveryLinkKind): boolean {
  return PROBLEM_KINDS.has(kind);
}

function paramsFromHref(href: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  if (url.hash.startsWith('#')) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }
  // supabase-js parseParametersFromURL lets the query string override the fragment.
  url.searchParams.forEach((value, key) => {
    params.set(key, value);
  });
  return params;
}

function safeErrorCode(code: string | null): string | null {
  if (!code) return null;
  return /^[a-z0-9_]{1,64}$/i.test(code) ? code : null;
}

function classifyProviderError(code: string | null, description: string): RecoveryLinkKind {
  const text = description.toLowerCase();
  const reused = /already been used|already used|previously used|been used|reused/.test(text);
  const expired = /expired/.test(text);
  const invalid = /invalid/.test(text);
  if (reused) return 'reused';
  if (expired && invalid) return 'invalid_or_expired';
  if (expired) return 'expired';
  if (invalid) return 'invalid';
  // GoTrue reports both expired and already-consumed recovery links as otp_expired
  // and often uses one description: "Email link is invalid or has expired".
  if (code === 'otp_expired' || code === 'flow_state_expired') return 'invalid_or_expired';
  return 'provider';
}

export function assessRecoveryLink(href: string): RecoveryLinkAssessment {
  const params = paramsFromHref(href);
  if (!params) return { kind: 'none', code: null };

  const error = params.get('error');
  const errorCode = params.get('error_code');
  const errorDescription = params.get('error_description') ?? '';
  const type = params.get('type');
  const hasAccess = Boolean(params.get('access_token') && params.get('refresh_token'));
  const hasTokenHash = Boolean(params.get('token_hash'));
  const hasMaterial = Boolean(
    params.get('access_token') ||
      params.get('refresh_token') ||
      params.get('token') ||
      params.get('token_hash') ||
      params.get('code'),
  );
  const hasCallback = Boolean(error || errorCode || errorDescription || type || hasMaterial);
  if (!hasCallback) return { kind: 'none', code: null };

  if (error || errorCode || errorDescription) {
    return {
      kind: classifyProviderError(errorCode, errorDescription),
      code: safeErrorCode(errorCode),
    };
  }

  if (type === 'recovery' && hasTokenHash) return { kind: 'token_hash', code: null };
  if (type === 'recovery' && hasAccess) return { kind: 'implicit', code: null };
  if (type === 'recovery') return { kind: 'missing', code: null };
  if (hasMaterial || type) return { kind: 'invalid', code: null };
  return { kind: 'missing', code: null };
}

export function readRecoveryTokenHash(href: string): string | null {
  if (assessRecoveryLink(href).kind !== 'token_hash') return null;
  const params = paramsFromHref(href);
  const tokenHash = params?.get('token_hash') ?? null;
  return tokenHash && tokenHash.trim() ? tokenHash : null;
}

export function stripAuthParams(href: string): string {
  const url = new URL(href);
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

/** Only an in-app reset path is accepted. Rejects protocol-relative and external URLs. */
export function safeResetNextPath(value: string | null): '/reset-password' | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) {
    return null;
  }
  const path = value.split('?')[0]?.split('#')[0] ?? '';
  return path === '/reset-password' ? '/reset-password' : null;
}

export function shouldHoldForRecovery(input: {
  recoveryPending: boolean;
  hasUser: boolean;
  callbackKind: RecoveryLinkKind;
  pathname: string;
}): boolean {
  if (input.pathname === '/reset-password' || input.pathname === '/auth/confirm') return false;
  if (input.recoveryPending && input.hasUser) return true;
  if (input.callbackKind === 'token_hash') return true;
  if (isRecoveryProblem(input.callbackKind)) return true;
  return false;
}

let captured: RecoveryLinkAssessment = { kind: 'none', code: null };
let capturedTokenHash: string | null = null;
let didCapture = false;
let dismissed = false;

export function captureBrowserAuthCallback(href: string = typeof window === 'undefined' ? '' : window.location.href): RecoveryLinkAssessment {
  if (didCapture) return getCapturedCallback();
  didCapture = true;
  if (!href) return captured;
  captured = assessRecoveryLink(href);
  capturedTokenHash = readRecoveryTokenHash(href);
  if (captured.kind === 'implicit' || captured.kind === 'token_hash') {
    markPasswordRecoveryPending();
  }
  return captured;
}

export function getCapturedCallback(): RecoveryLinkAssessment {
  if (dismissed) return { kind: 'none', code: null };
  return captured;
}

export function takeRecoveryTokenHash(): string | null {
  const value = capturedTokenHash;
  capturedTokenHash = null;
  return value;
}

/** Puts a token hash back after a network failure so the user can retry without a new email. */
export function restoreRecoveryTokenHash(tokenHash: string): void {
  if (!dismissed && tokenHash) capturedTokenHash = tokenHash;
}

export function dismissCapturedCallback(): void {
  dismissed = true;
  capturedTokenHash = null;
}

export function stripBrowserAuthCallback(): void {
  if (typeof window === 'undefined') return;
  const current = window.location.href;
  let clean: string;
  try {
    clean = stripAuthParams(current);
  } catch {
    return;
  }
  if (clean === current) return;
  window.history.replaceState(window.history.state, '', clean);
}

export function isPasswordRecoveryPending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PASSWORD_RECOVERY_FLAG) === '1';
  } catch {
    return false;
  }
}

export function markPasswordRecoveryPending(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PASSWORD_RECOVERY_FLAG, '1');
  } catch {
    // Private mode can reject storage. The in-memory callback kind still guides this tab.
  }
}

export function clearPasswordRecoveryPending(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PASSWORD_RECOVERY_FLAG);
  } catch {
    // Ignore storage failures; the caller also clears React state.
  }
}

/** Test helper. Production code captures once, at startup. */
export function resetRecoveryCallbackStateForTests(): void {
  captured = { kind: 'none', code: null };
  capturedTokenHash = null;
  didCapture = false;
  dismissed = false;
}
