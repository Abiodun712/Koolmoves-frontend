import { beforeEach, describe, expect, it } from 'vitest';
import {
  assessRecoveryLink,
  captureBrowserAuthCallback,
  dismissCapturedCallback,
  getCapturedCallback,
  PASSWORD_RECOVERY_FLAG,
  readRecoveryTokenHash,
  resetRecoveryCallbackStateForTests,
  safeResetNextPath,
  shouldHoldForRecovery,
  stripAuthParams,
  takeRecoveryTokenHash,
} from './recoveryCallback';

const TOKEN = 'super-secret-recovery-token';
const HASH = 'super-secret-token-hash';

describe('assessRecoveryLink', () => {
  it('ignores an ordinary page URL', () => {
    expect(assessRecoveryLink('https://koolmovez.com/reset-password')).toEqual({ kind: 'none', code: null });
  });

  it('recognizes an implicit recovery fragment without returning the tokens', () => {
    const href = `https://koolmovez.com/reset-password#access_token=${TOKEN}&expires_in=3600&refresh_token=refresh-${TOKEN}&token_type=bearer&type=recovery`;
    const assessment = assessRecoveryLink(href);
    expect(assessment).toEqual({ kind: 'implicit', code: null });
    expect(JSON.stringify(assessment)).not.toContain(TOKEN);
  });

  it('recognizes a token_hash recovery link and can read the hash once', () => {
    const href = `https://koolmovez.com/reset-password?token_hash=${HASH}&type=recovery`;
    expect(assessRecoveryLink(href)).toEqual({ kind: 'token_hash', code: null });
    expect(readRecoveryTokenHash(href)).toBe(HASH);
    expect(readRecoveryTokenHash('https://koolmovez.com/reset-password?type=recovery')).toBeNull();
  });

  it('treats a recovery link without token material as missing', () => {
    expect(assessRecoveryLink('https://koolmovez.com/reset-password?type=recovery')).toEqual({
      kind: 'missing',
      code: null,
    });
    expect(assessRecoveryLink('https://koolmovez.com/reset-password#type=recovery')).toEqual({
      kind: 'missing',
      code: null,
    });
  });

  it('rejects auth callbacks that are not password recovery', () => {
    expect(
      assessRecoveryLink('https://koolmovez.com/reset-password#access_token=abc&refresh_token=def&type=signup'),
    ).toEqual({ kind: 'invalid', code: null });
    expect(assessRecoveryLink('https://koolmovez.com/reset-password?code=pkce-code')).toEqual({
      kind: 'invalid',
      code: null,
    });
  });

  it('distinguishes expired, reused, and combined invalid-or-expired provider errors', () => {
    expect(
      assessRecoveryLink(
        'https://koolmovez.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired',
      ),
    ).toEqual({ kind: 'expired', code: 'otp_expired' });

    expect(
      assessRecoveryLink(
        'https://koolmovez.com/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+has+already+been+used',
      ),
    ).toEqual({ kind: 'reused', code: 'otp_expired' });

    expect(
      assessRecoveryLink(
        'https://koolmovez.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({ kind: 'invalid_or_expired', code: 'otp_expired' });

    expect(
      assessRecoveryLink(
        'https://koolmovez.com/reset-password#error=access_denied&error_code=otp_expired&error_description=',
      ),
    ).toEqual({ kind: 'invalid_or_expired', code: 'otp_expired' });
  });

  it('lets the query string override the fragment, matching supabase-js', () => {
    const href = `https://koolmovez.com/reset-password?error_code=otp_expired&error_description=already+used#access_token=${TOKEN}&refresh_token=r&type=recovery`;
    expect(assessRecoveryLink(href).kind).toBe('reused');
  });

  it('drops tokens, hashes, and provider errors from the URL while keeping unrelated query params', () => {
    const href = `https://koolmovez.com/reset-password?utm=newsletter&token_hash=${HASH}&type=recovery#access_token=${TOKEN}`;
    const clean = stripAuthParams(href);
    expect(clean).toBe('https://koolmovez.com/reset-password?utm=newsletter');
    expect(clean).not.toContain(TOKEN);
    expect(clean).not.toContain(HASH);
  });

  it('accepts only the in-app reset path as a next destination', () => {
    expect(safeResetNextPath('/reset-password')).toBe('/reset-password');
    expect(safeResetNextPath('/reset-password?evil=1')).toBe('/reset-password');
    expect(safeResetNextPath('/home')).toBeNull();
    expect(safeResetNextPath('//evil.example/reset-password')).toBeNull();
    expect(safeResetNextPath('https://evil.example/reset-password')).toBeNull();
    expect(safeResetNextPath('/reset-password/../admin')).toBeNull();
  });
});

describe('shouldHoldForRecovery', () => {
  it('keeps the reset screen itself available', () => {
    expect(
      shouldHoldForRecovery({
        recoveryPending: true,
        hasUser: true,
        callbackKind: 'implicit',
        pathname: '/reset-password',
      }),
    ).toBe(false);
    expect(
      shouldHoldForRecovery({
        recoveryPending: true,
        hasUser: true,
        callbackKind: 'token_hash',
        pathname: '/auth/confirm',
      }),
    ).toBe(false);
  });

  it('holds every other route for an active recovery session, a token hash, or a broken link', () => {
    expect(
      shouldHoldForRecovery({
        recoveryPending: true,
        hasUser: true,
        callbackKind: 'none',
        pathname: '/home',
      }),
    ).toBe(true);
    expect(
      shouldHoldForRecovery({
        recoveryPending: true,
        hasUser: true,
        callbackKind: 'none',
        pathname: '/admin',
      }),
    ).toBe(true);
    expect(
      shouldHoldForRecovery({
        recoveryPending: false,
        hasUser: false,
        callbackKind: 'token_hash',
        pathname: '/login',
      }),
    ).toBe(true);
    expect(
      shouldHoldForRecovery({
        recoveryPending: false,
        hasUser: true,
        callbackKind: 'expired',
        pathname: '/',
      }),
    ).toBe(true);
  });

  it('does not hold a normal signed-in visit', () => {
    expect(
      shouldHoldForRecovery({
        recoveryPending: false,
        hasUser: true,
        callbackKind: 'none',
        pathname: '/home',
      }),
    ).toBe(false);
  });
});

describe('captureBrowserAuthCallback', () => {
  beforeEach(() => {
    resetRecoveryCallbackStateForTests();
    localStorage.clear();
  });

  it('marks recovery pending for a real link and never exposes the token hash to the UI snapshot', () => {
    const href = `https://koolmovez.com/auth/confirm?token_hash=${HASH}&type=recovery&next=/reset-password`;
    captureBrowserAuthCallback(href);
    expect(getCapturedCallback()).toEqual({ kind: 'token_hash', code: null });
    expect(JSON.stringify(getCapturedCallback())).not.toContain(HASH);
    expect(localStorage.getItem(PASSWORD_RECOVERY_FLAG)).toBe('1');
    expect(takeRecoveryTokenHash()).toBe(HASH);
    expect(takeRecoveryTokenHash()).toBeNull();
  });

  it('can dismiss a broken link so later navigation is not forced back to reset', () => {
    captureBrowserAuthCallback(
      'https://koolmovez.com/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );
    expect(getCapturedCallback().kind).toBe('invalid');
    dismissCapturedCallback();
    expect(getCapturedCallback()).toEqual({ kind: 'none', code: null });
  });
});
