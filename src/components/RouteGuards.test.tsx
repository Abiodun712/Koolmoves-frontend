import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAdmin, RequireAuth } from './RouteGuards';

const { auth } = vi.hoisted(() => ({
  auth: {
    user: null as { id: string } | null,
    role: null as string | null,
    loading: false,
    recoveryPending: false,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    profile: null,
    role: auth.role,
    loading: auth.loading,
    recoveryPending: auth.recoveryPending,
    finishPasswordRecovery: vi.fn(),
    logout: vi.fn(),
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderAt(path: string, element: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/home" element={element} />
          <Route path="/admin" element={element} />
          <Route path="/reset-password" element={<div>Reset destination</div>} />
          <Route path="/login" element={<div>Login destination</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

describe('route guards during password recovery', () => {
  beforeEach(() => {
    auth.user = { id: 'user-1' };
    auth.role = 'admin';
    auth.loading = false;
    auth.recoveryPending = false;
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

  it('sends a recovery session to reset instead of the user or admin app', async () => {
    auth.recoveryPending = true;
    await renderAt('/home', (
      <RequireAuth>
        <div>Private home</div>
      </RequireAuth>
    ));
    expect(container?.textContent).toContain('Reset destination');
    expect(container?.textContent).not.toContain('Private home');

    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    await renderAt('/admin', (
      <RequireAdmin>
        <div>Private admin</div>
      </RequireAdmin>
    ));
    expect(container?.textContent).toContain('Reset destination');
    expect(container?.textContent).not.toContain('Private admin');
    expect(container?.textContent).not.toContain('Private home');
  });

  it('still admits a normal session and sends anonymous visitors to login', async () => {
    await renderAt('/home', (
      <RequireAuth>
        <div>Private home</div>
      </RequireAuth>
    ));
    expect(container?.textContent).toContain('Private home');

    auth.user = null;
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    await renderAt('/admin', (
      <RequireAdmin>
        <div>Private admin</div>
      </RequireAdmin>
    ));
    expect(container?.textContent).toContain('Login destination');
  });
});
