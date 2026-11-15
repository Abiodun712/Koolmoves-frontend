import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );
  });
}

function emailInput() {
  return container?.querySelector('#reset-email') as HTMLInputElement;
}

function status() {
  return container?.querySelector('[data-testid="reset-request-status"]')?.textContent ?? '';
}

async function setEmail(value: string) {
  const input = emailInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container?.querySelector('form');
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset();
    window.history.replaceState(null, '', 'http://localhost:3000/forgot-password');
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

  it('links back to login and does not ask the provider for an invalid email', async () => {
    await renderPage();
    expect(container?.querySelector('a[href="/login"]')?.textContent).toBe('Back to log in');
    await setEmail('not-an-email');
    await submit();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(status()).toBe('Enter a valid email address.');
    expect(container?.querySelector('button[type="submit"]')?.textContent).toBe('Try again');
  });

  it('shows the same confirmation for a sent link and for an unknown account', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    await renderPage();
    await setEmail('ada@example.com');
    await submit();
    const sent = status();
    expect(resetPasswordForEmail).toHaveBeenCalledWith('ada@example.com', {
      redirectTo: 'http://localhost:3000/reset-password',
    });
    expect(sent).toContain('If an account exists for ada@example.com');
    expect(sent.toLowerCase()).not.toContain('not found');

    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'User not found', code: 'user_not_found', status: 400 },
    });
    const different = container?.querySelector('button[type="button"]') as HTMLButtonElement;
    await act(async () => {
      different.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await setEmail('missing@example.com');
    await submit();
    expect(status()).toBe(sent.replace('ada@example.com', 'missing@example.com'));
    expect(status().toLowerCase()).not.toContain('not found');
    expect(status().toLowerCase()).not.toContain('no account');
  });

  it('shows rate-limit, network, and provider failures with a retry and never prints a token', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'For security purposes, you can only request this after 42 seconds.', status: 429 },
    });
    await renderPage();
    await setEmail('ada@example.com');
    await submit();
    expect(status()).toBe('Too many reset requests. Please wait 42 seconds and try again.');
    expect(container?.querySelector('button[type="submit"]')?.textContent).toBe('Try again');

    resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await submit();
    expect(status()).toBe("We couldn't reach the server. Check your connection and try again.");

    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Error sending recovery email access_token=super-secret-recovery-token', status: 500 },
    });
    await submit();
    expect(status()).toBe("We couldn't send the reset email right now. Please try again in a moment.");
    expect(container?.textContent).not.toContain('super-secret-recovery-token');
  });

  it('shows a loading label while the request is in flight', async () => {
    let resolveRequest: (value: { data: object; error: null }) => void = () => {};
    resetPasswordForEmail.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    await renderPage();
    await setEmail('ada@example.com');
    await submit();
    expect(container?.querySelector('button[aria-busy="true"]')?.textContent).toBe('Sending reset link...');
    await act(async () => {
      resolveRequest({ data: {}, error: null });
    });
    expect(status()).toContain('If an account exists');
  });
});
