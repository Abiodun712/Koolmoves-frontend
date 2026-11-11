import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureBrowserAuthCallback,
  resetRecoveryCallbackStateForTests,
} from '../lib/recoveryCallback';
import { RecoveryGate } from './RecoveryGate';

const { auth } = vi.hoisted(() => ({
  auth: {
    user: null as { id: string } | null,
    loading: false,
    recoveryPending: false,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    profile: null,
    role: null,
    loading: auth.loading,
    recoveryPending: auth.recoveryPending,
    finishPasswordRecovery: vi.fn(),
    logout: vi.fn(),
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderAt(path: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <RecoveryGate />
        <Routes>
          <Route path="/" element={<div>Landing</div>} />
          <Route path="/login" element={<div>Login screen</div>} />
          <Route path="/reset-password" element={<div>Reset screen</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

describe('RecoveryGate', () => {
  beforeEach(() => {
    auth.user = null;
    auth.loading = false;
    auth.recoveryPending = false;
    resetRecoveryCallbackStateForTests();
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

  it('moves an active recovery session off the landing page and leaves the reset screen alone', async () => {
    auth.user = { id: 'user-1' };
    auth.recoveryPending = true;
    await renderAt('/');
    expect(container?.textContent).toContain('Reset screen');
    expect(container?.textContent).not.toContain('Landing');

    await act(async () => root?.unmount());
    container?.remove();
    await renderAt('/reset-password');
    expect(container?.textContent).toContain('Reset screen');
  });

  it('sends a token-hash or broken recovery link to the reset screen before a session exists', async () => {
    captureBrowserAuthCallback('https://koolmovez.com/login?token_hash=hash-value&type=recovery');
    await renderAt('/login');
    expect(container?.textContent).toContain('Reset screen');
    expect(container?.textContent).not.toContain('hash-value');

    resetRecoveryCallbackStateForTests();
    captureBrowserAuthCallback(
      'https://koolmovez.com/?error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    await act(async () => root?.unmount());
    container?.remove();
    await renderAt('/');
    expect(container?.textContent).toContain('Reset screen');
  });

  it('does not redirect a normal visit', async () => {
    auth.user = { id: 'user-1' };
    await renderAt('/');
    expect(container?.textContent).toContain('Landing');
  });
});
