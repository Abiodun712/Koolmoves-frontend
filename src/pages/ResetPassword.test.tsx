import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureBrowserAuthCallback,
  PASSWORD_RECOVERY_FLAG,
  resetRecoveryCallbackStateForTests,
} from '../lib/recoveryCallback';
import { resetRecoveryVerificationForTests } from '../lib/passwordReset';
import ResetPassword from './ResetPassword';

const { auth, api } = vi.hoisted(() => ({
  auth: {
    user: null as { id: string; email: string } | null,
    role: null as string | null,
    recoveryPending: false,
    finishPasswordRecovery: vi.fn(),
  },
  api: {
    updateUser: vi.fn(),
    verifyOtp: vi.fn(),
    signOut: vi.fn(),
    role: 'user' as string | null,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    profile: null,
    role: auth.role,
    loading: false,
    recoveryPending: auth.recoveryPending,
    finishPasswordRecovery: auth.finishPasswordRecovery,
    logout: vi.fn(),
  }),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => api.updateUser(...args),
      verifyOtp: (...args: unknown[]) => api.verifyOtp(...args),
      signOut: (...args: unknown[]) => api.signOut(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: api.role ? { role: api.role } : null, error: null }),
        }),
      }),
    }),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
    container?.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/home" element={<div>Home destination</div>} />
          <Route path="/admin" element={<div>Admin destination</div>} />
          <Route path="/login" element={<div>Login destination</div>} />
          <Route path="/forgot-password" element={<div>Forgot destination</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function status() {
  return container?.querySelector('[data-testid="reset-password-status"]')?.textContent ?? '';
}

async function setInput(id: string, value: string) {
  const input = container?.querySelector(id) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((item) => item.textContent === label);
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ResetPassword', () => {
  beforeEach(() => {
    auth.user = null;
    auth.role = null;
    auth.recoveryPending = false;
    auth.finishPasswordRecovery.mockReset();
    api.updateUser.mockReset();
    api.verifyOtp.mockReset();
    api.signOut.mockReset();
    api.signOut.mockResolvedValue({ error: null });
    api.role = 'user';
    resetRecoveryCallbackStateForTests();
    resetRecoveryVerificationForTests();
    localStorage.clear();
    window.history.replaceState(null, '', 'http://localhost:3000/reset-password');
  });

  afterEach(async () => {
    if (root) {
      const mounted = root;
      await act(async () => mounted.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('explains a direct visit that has no recovery link', async () => {
    await renderPage();
    expect(status()).toBe('Open the password reset link from your email, or request a new one.');
    expect(container?.querySelector('#new-password')).toBeNull();
  });

  it('shows distinct invalid, expired, reused, and missing links without rendering tokens', async () => {
    const secret = 'super-secret-recovery-token';
    captureBrowserAuthCallback(
      `https://koolmovez.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired&access_token=${secret}`,
    );
    await renderPage();
    expect(status()).toBe('This reset link has expired. Request a new one.');
    expect(container?.textContent).not.toContain(secret);

    resetRecoveryCallbackStateForTests();
    captureBrowserAuthCallback(
      'https://koolmovez.com/reset-password?error_description=Email+link+has+already+been+used&error_code=otp_expired',
    );
    await renderPage();
    expect(status()).toContain('already used');

    resetRecoveryCallbackStateForTests();
    captureBrowserAuthCallback('https://koolmovez.com/reset-password?type=recovery');
    await renderPage();
    expect(status()).toContain('missing required information');

    resetRecoveryCallbackStateForTests();
    captureBrowserAuthCallback(
      'https://koolmovez.com/reset-password#error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    await renderPage();
    expect(status()).toContain('invalid or has expired');
    expect(status()).toContain('already been used');
  });

  it('checks the new password locally before calling the provider', async () => {
    auth.user = { id: 'user-1', email: 'ada@example.com' };
    auth.recoveryPending = true;
    await renderPage();
    expect(container?.textContent).toContain('a***@example.com');
    expect(container?.textContent).not.toContain('ada@example.com');

    await setInput('#new-password', 'short');
    await setInput('#confirm-password', 'short');
    await submit();
    expect(api.updateUser).not.toHaveBeenCalled();
    expect(status()).toBe('Password must be at least 6 characters long.');

    await setInput('#new-password', 'long-enough');
    await setInput('#confirm-password', 'different');
    await submit();
    expect(api.updateUser).not.toHaveBeenCalled();
    expect(status()).toBe('Passwords do not match.');
  });

  it('updates the password and opens the account for the saved role', async () => {
    auth.user = { id: 'user-1', email: 'ada@example.com' };
    auth.recoveryPending = true;
    auth.finishPasswordRecovery.mockImplementation(() => {
      localStorage.removeItem(PASSWORD_RECOVERY_FLAG);
    });
    api.role = 'admin';
    localStorage.setItem(PASSWORD_RECOVERY_FLAG, '1');
    api.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    await renderPage();
    await setInput('#new-password', 'long-enough');
    await setInput('#confirm-password', 'long-enough');
    await submit();
    expect(api.updateUser).toHaveBeenCalledWith({ password: 'long-enough' });
    expect(auth.finishPasswordRecovery).toHaveBeenCalled();
    expect(container?.textContent).toContain('Admin destination');
    expect(localStorage.getItem(PASSWORD_RECOVERY_FLAG)).toBeNull();
  });

  it('keeps the form available for same-password, weak-password, and network errors', async () => {
    auth.user = { id: 'user-1', email: 'ada@example.com' };
    auth.recoveryPending = true;
    api.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'same_password', message: 'New password should be different from the old password.' },
    });
    await renderPage();
    await setInput('#new-password', 'long-enough');
    await setInput('#confirm-password', 'long-enough');
    await submit();
    expect(status()).toBe('Choose a password that is different from your current one.');
    expect(container?.querySelector('#new-password')).not.toBeNull();

    api.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' },
    });
    await submit();
    expect(status()).toBe('That password is too easy to guess. Choose a different one.');

    api.updateUser.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await submit();
    expect(status()).toBe("We couldn't reach the server. Check your connection and try again.");
    expect(container?.querySelector('button[type="submit"]')?.textContent).toBe('Update password');
  });

  it('does not render a provider message that contains a token', async () => {
    auth.user = { id: 'user-1', email: 'ada@example.com' };
    auth.recoveryPending = true;
    api.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'access_token=super-secret-recovery-token', status: 500 },
    });
    await renderPage();
    await setInput('#new-password', 'long-enough');
    await setInput('#confirm-password', 'long-enough');
    await submit();
    expect(status()).toBe("We couldn't update your password. Please try again.");
    expect(container?.textContent).not.toContain('super-secret-recovery-token');
  });

  it('verifies a token hash, then offers a new link when the hash was already used', async () => {
    const tokenHash = 'one-time-hash-value';
    captureBrowserAuthCallback(`https://koolmovez.com/reset-password?token_hash=${tokenHash}&type=recovery`);
    api.verifyOtp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { code: 'otp_expired', message: 'Email link has already been used' },
    });
    await renderPage();
    expect(api.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: tokenHash });
    expect(status()).toBe('This reset link was already used. Request a new one.');
    expect(container?.textContent).not.toContain(tokenHash);
    await clickButton('Request a new link');
    expect(container?.textContent).toContain('Forgot destination');
  });

  it('retries a token hash after a network failure', async () => {
    captureBrowserAuthCallback('https://koolmovez.com/reset-password?token_hash=retry-hash&type=recovery');
    api.verifyOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    api.verifyOtp.mockResolvedValueOnce({ data: { session: {}, user: {} }, error: null });
    await renderPage();
    expect(status()).toBe("We couldn't reach the server. Check your connection and try again.");
    await clickButton('Try again');
    expect(api.verifyOtp).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('#new-password')).not.toBeNull();
  });

  it('signs out only the recovery session when the reset is cancelled', async () => {
    auth.user = { id: 'user-1', email: 'ada@example.com' };
    auth.recoveryPending = true;
    localStorage.setItem(PASSWORD_RECOVERY_FLAG, '1');
    await renderPage();
    await clickButton('Cancel');
    expect(api.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.finishPasswordRecovery).toHaveBeenCalled();
    expect(container?.textContent).toContain('Login destination');
  });
});
