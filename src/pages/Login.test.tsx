import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabaseClient';
import { deviceUnlockSupported, signInWithDeviceUnlock } from '../lib/passkeyClient';
import Login from './Login';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      getUser: vi.fn(),
      getSession: vi.fn(),
      setSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

vi.mock('../lib/passkeyClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/passkeyClient')>('../lib/passkeyClient');
  return {
    ...actual,
    deviceUnlockSupported: vi.fn(() => true),
    signInWithDeviceUnlock: vi.fn(),
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function renderLogin() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<div>Admin home</div>} />
          <Route path="/home" element={<div>Customer home</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

describe('Login', () => {
  it('links to the password reset request screen', async () => {
    await renderLogin();
    const link = container?.querySelector('a[href="/forgot-password"]');
    expect(link?.textContent).toBe('Forgot password?');
    expect(link?.getAttribute('href')).toBe('/forgot-password');
    expect(container?.textContent).toContain('fingerprint, face, and device PIN stay on this device');
  });

  it('still signs in with a password and opens the admin area for an admin', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'admin-user' } },
      error: null,
    } as never);
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'admin' }, error: null }),
        }),
      }),
    } as never);
    await renderLogin();
    setValue(container?.querySelector('#login-email'), 'ada@example.com');
    setValue(container?.querySelector('#login-password'), 'secret');
    await act(async () => {
      container?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
    });
    expect(container?.textContent).toContain('Admin home');
  });

  it('does not leave the login screen when device sign-in is cancelled', async () => {
    vi.mocked(signInWithDeviceUnlock).mockResolvedValue({ ok: false, reason: 'cancelled' });
    await renderLogin();
    await act(async () => {
      container?.querySelector('button[type="button"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container?.textContent).toContain('Device sign-in was cancelled');
    expect(container?.textContent).not.toContain('Admin home');
    expect(container?.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('opens the customer home only after device sign-in returns a session', async () => {
    vi.mocked(signInWithDeviceUnlock).mockResolvedValue({ ok: true });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'customer' } },
      error: null,
    } as never);
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'customer' }, error: null }),
        }),
      }),
    } as never);
    await renderLogin();
    await act(async () => {
      container?.querySelector('button[type="button"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container?.textContent).toContain('Customer home');
  });

  it('explains when this browser cannot use the device unlock prompt', async () => {
    vi.mocked(deviceUnlockSupported).mockReturnValue(false);
    await renderLogin();
    const button = container?.querySelector('button[type="button"]');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(container?.textContent).toContain('This browser cannot use fingerprint, face, or device PIN');
  });
});

function setValue(input: Element | null | undefined, value: string) {
  if (!(input instanceof HTMLInputElement)) throw new Error('missing input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
