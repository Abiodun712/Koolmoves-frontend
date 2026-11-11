import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginRecoveryVerification,
  classifyPasswordUpdateError,
  classifyResetRequestError,
  maskEmail,
  passwordResetRedirectTo,
  passwordUpdateMessage,
  postResetPath,
  recoveryProblemMessage,
  resetRecoveryVerificationForTests,
  resetRequestMessage,
} from './passwordReset';
import {
  captureBrowserAuthCallback,
  resetRecoveryCallbackStateForTests,
} from './recoveryCallback';

describe('classifyResetRequestError', () => {
  it('hides account existence, including not-found and unconfirmed results', () => {
    expect(classifyResetRequestError(null)).toBeNull();
    expect(classifyResetRequestError({ message: 'User not found', code: 'user_not_found', status: 400 })).toBeNull();
    expect(classifyResetRequestError({ message: 'Email address not confirmed', status: 400 })).toBeNull();
  });

  it('reports validation, rate limits, network failures, and other provider failures', () => {
    expect(classifyResetRequestError({ message: 'Unable to validate email address' })).toEqual({
      type: 'validation',
      retryAfterSeconds: null,
    });
    expect(
      classifyResetRequestError({
        message: 'For security purposes, you can only request this after 42 seconds.',
        status: 429,
        code: 'over_email_send_rate_limit',
      }),
    ).toEqual({ type: 'rate_limit', retryAfterSeconds: 42 });
    expect(classifyResetRequestError({ message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 })).toEqual({
      type: 'network',
      retryAfterSeconds: null,
    });
    expect(classifyResetRequestError({ message: 'Error sending recovery email', status: 500 })).toEqual({
      type: 'provider',
      retryAfterSeconds: null,
    });
  });

  it('uses one generic sent message for success and for hidden enumeration errors', () => {
    const email = 'ada@example.com';
    const sent = resetRequestMessage('sent', email, null);
    expect(sent).toContain('If an account exists for ada@example.com');
    expect(sent.toLowerCase()).not.toContain('not found');
    expect(sent.toLowerCase()).not.toContain('no account');
  });
});

describe('classifyPasswordUpdateError', () => {
  it('maps provider password failures without copying tokens into the message', () => {
    expect(classifyPasswordUpdateError({ code: 'same_password', message: 'New password should be different from the old password.' }).type).toBe(
      'same_password',
    );
    expect(classifyPasswordUpdateError({ code: 'weak_password', message: 'Password is known to be weak and easy to guess' }).type).toBe(
      'weak_password',
    );
    expect(classifyPasswordUpdateError({ message: 'Password should be at least 8 characters' })).toMatchObject({
      type: 'validation',
      minimumLength: 8,
    });
    expect(passwordUpdateMessage({ type: 'validation', retryAfterSeconds: null, minimumLength: 8 })).toBe(
      'Password must be at least 8 characters long.',
    );
    expect(classifyPasswordUpdateError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }).type).toBe(
      'session_expired',
    );
    const leaked = classifyPasswordUpdateError({ message: 'access_token=super-secret-recovery-token' });
    expect(leaked.type).toBe('provider');
    expect(passwordUpdateMessage(leaked)).not.toContain('super-secret-recovery-token');
  });
});

describe('recovery helpers', () => {
  beforeEach(() => {
    resetRecoveryCallbackStateForTests();
    resetRecoveryVerificationForTests();
  });

  it('builds an origin-scoped reset redirect and an in-app destination', () => {
    expect(passwordResetRedirectTo('https://koolmovez.com')).toBe('https://koolmovez.com/reset-password');
    expect(postResetPath('admin')).toBe('/admin');
    expect(postResetPath('user')).toBe('/home');
    expect(postResetPath(null)).toBe('/home');
    expect(maskEmail('ada@example.com')).toBe('a***@example.com');
    expect(recoveryProblemMessage('reused')).toContain('already used');
  });

  it('verifies a captured token hash once, then allows a retry after a network failure', async () => {
    const tokenHash = 'one-time-hash';
    captureBrowserAuthCallback(`https://koolmovez.com/reset-password?token_hash=${tokenHash}&type=recovery`);
    const seen: string[] = [];
    let attempt = 0;
    const verify = (hash: string) => {
      seen.push(hash);
      attempt += 1;
      if (attempt === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ error: null });
    };

    const first = beginRecoveryVerification(verify);
    await expect(first).resolves.toEqual({ ok: false, kind: 'provider', network: true });
    const second = beginRecoveryVerification(verify);
    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual({ ok: true });
    expect(seen).toEqual([tokenHash, tokenHash]);
    expect(beginRecoveryVerification(verify)).toBe(second);
  });

  it('classifies an expired or reused verifyOtp error and does not retry it', async () => {
    captureBrowserAuthCallback('https://koolmovez.com/reset-password?token_hash=used-hash&type=recovery');
    const verify = () =>
      Promise.resolve({
        error: { code: 'otp_expired', message: 'Email link is invalid or has expired' },
      });
    const pending = beginRecoveryVerification(verify);
    await expect(pending).resolves.toEqual({ ok: false, kind: 'invalid_or_expired', network: false });
    expect(beginRecoveryVerification(verify)).toBe(pending);
  });
});
