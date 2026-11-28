import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NairaAccountRequest } from './NairaAccountRequest';

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

async function render(phase: 'idle' | 'ready', onRequest = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NairaAccountRequest
        phase={phase}
        account={phase === 'ready'
          ? { bankName: 'Shown Bank', accountName: 'KoolMovez Collections', accountNumber: '1111222233' }
          : null}
        onRequest={onRequest}
      />,
    );
  });
  return onRequest;
}

describe('NairaAccountRequest', () => {
  it('shows the request button and no account number until the customer asks', async () => {
    const onRequest = await render('idle');
    expect(container?.textContent).toContain('Request Naira account');
    expect(container?.textContent).toContain('stay hidden');
    expect(container?.querySelector('[data-testid="naira-account-number"]')).toBeNull();
    expect(container?.textContent).not.toContain('1111222233');
    const button = container?.querySelector('[data-testid="request-naira-account"]') as HTMLButtonElement;
    expect(button.type).toBe('button');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('shows one account after it has been requested', async () => {
    await render('ready');
    expect(container?.querySelector('[data-testid="request-naira-account"]')).toBeNull();
    expect(container?.querySelector('[data-testid="naira-account-number"]')?.textContent).toBe('1111222233');
    expect(container?.textContent).toContain('Shown Bank');
    expect(container?.textContent).toContain('KoolMovez Collections');
    expect(container?.textContent).not.toContain('9999888877');
  });
});
