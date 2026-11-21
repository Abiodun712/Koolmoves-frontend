import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasskeyManager from './PasskeyManager';
import { listDeviceUnlocks, registerDeviceUnlock, revokeDeviceUnlock } from '../lib/passkeyClient';
import { supabase } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user' } }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'token-token-token-token' } } })),
    },
  },
}));

vi.mock('../lib/passkeyClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/passkeyClient')>('../lib/passkeyClient');
  return {
    ...actual,
    deviceUnlockSupported: vi.fn(() => true),
    listDeviceUnlocks: vi.fn(async () => ({
      ok: true,
      credentials: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          deviceLabel: 'Ada’s phone',
          createdAt: '2026-11-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    })),
    registerDeviceUnlock: vi.fn(),
    revokeDeviceUnlock: vi.fn(async () => ({ ok: true })),
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
  vi.unstubAllGlobals();
});

async function renderManager() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<PasskeyManager />);
  });
}

describe('PasskeyManager', () => {
  it('lists a saved device and explains that the fingerprint stays on the device', async () => {
    await renderManager();
    expect(container?.textContent).toContain('Ada’s phone');
    expect(container?.textContent).toContain('fingerprint, face, and device PIN stay on this device');
    expect(listDeviceUnlocks).toHaveBeenCalledWith('token-token-token-token');
  });

  it('removes a device only after confirmation and keeps the password available', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    await renderManager();
    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(revokeDeviceUnlock).toHaveBeenCalledWith(
      'token-token-token-token',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(container?.textContent).toContain('Your password still works');
  });

  it('does not remove a device when confirmation is dismissed', async () => {
    vi.mocked(revokeDeviceUnlock).mockClear();
    vi.stubGlobal('confirm', vi.fn(() => false));
    await renderManager();
    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(revokeDeviceUnlock).not.toHaveBeenCalled();
  });

  it('does not claim a device was added when registration is cancelled', async () => {
    vi.mocked(registerDeviceUnlock).mockResolvedValue({ ok: false, reason: 'cancelled' });
    await renderManager();
    const add = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Add this device'),
    );
    await act(async () => {
      add?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container?.textContent).toContain('Device sign-in was cancelled');
    expect(container?.textContent).not.toContain('This device can now sign in');
    expect(supabase.auth.getUser).toHaveBeenCalled();
  });
});
