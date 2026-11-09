import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import RmbExchangeCalculator from './RmbExchangeCalculator';
import type { PublishedRate } from '../lib/publishedExchangeRate';

const NOTE =
  'Indicative rate based on the current published rate. Final rate is locked when you create an exchange request inside your account.';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderCalculator(loadRate: () => Promise<PublishedRate>) {
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
      <MemoryRouter>
        <RmbExchangeCalculator loadRate={loadRate} refreshMs={0} />
      </MemoryRouter>,
    );
  });
}

afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function rateText() {
  return container?.querySelector('[data-testid="published-rate"]')?.textContent;
}

function ngnInput() {
  return container?.querySelector('#landing-ngn-amount') as HTMLInputElement;
}

function rmbInput() {
  return container?.querySelector('#landing-rmb-amount') as HTMLInputElement;
}

async function setAmount(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function expectStartExchange() {
  const link = container?.querySelector('[data-testid="start-exchange"]');
  expect(link?.getAttribute('href')).toBe('/signup');
  expect(link?.textContent).toBe('Start Exchange');
  expect(container?.querySelector('[data-testid="rate-note"]')?.textContent).toBe(NOTE);
}

describe('RmbExchangeCalculator', () => {
  it('shows loading, does not calculate, and still links to Create Account', async () => {
    let release: (value: PublishedRate) => void = () => {};
    const pending = new Promise<PublishedRate>((resolve) => {
      release = resolve;
    });
    await renderCalculator(() => pending);
    expect(rateText()).toBe('Loading published rate...');
    expect(rateText()).not.toMatch(/₦\d/);
    await setAmount(ngnInput(), '1000');
    expect(ngnInput().value).toBe('1000');
    expect(rmbInput().value).toBe('');
    expectStartExchange();

    await act(async () => {
      release({ status: 'ready', rate: 200 });
    });
    expect(rateText()).toBe('1 RMB = ₦200');
    expect(ngnInput().value).toBe('1000');
    expect(rmbInput().value).toBe('5.00');
  });

  it('shows unavailable and does not calculate when the fetch fails or the rate is non-positive', async () => {
    await renderCalculator(() => Promise.reject(new Error('offline')));
    expect(rateText()).toBe('Published rate unavailable');
    expect(rateText()).not.toMatch(/₦\d/);
    await setAmount(ngnInput(), '500');
    expect(ngnInput().value).toBe('500');
    expect(rmbInput().value).toBe('');
    expectStartExchange();

    await renderCalculator(() => Promise.resolve({ status: 'unavailable' }));
    expect(rateText()).toBe('Published rate unavailable');
    await setAmount(rmbInput(), '8');
    expect(rmbInput().value).toBe('8');
    expect(ngnInput().value).toBe('');

    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: 0 }));
    expect(rateText()).toBe('Published rate unavailable');
    await setAmount(ngnInput(), '100');
    expect(rmbInput().value).toBe('');

    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: Number.NaN }));
    expect(rateText()).toBe('Published rate unavailable');
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: Number.POSITIVE_INFINITY }));
    expect(rateText()).toBe('Published rate unavailable');
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: -10 }));
    expect(rateText()).toBe('Published rate unavailable');
    expectStartExchange();
  });

  it('updates either amount from the other and keeps the typed text', async () => {
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: 200 }));
    expect(rateText()).toBe('1 RMB = ₦200');

    await setAmount(ngnInput(), '500');
    expect(ngnInput().value).toBe('500');
    expect(rmbInput().value).toBe('2.50');

    await setAmount(rmbInput(), '4');
    expect(rmbInput().value).toBe('4');
    expect(ngnInput().value).toBe('800.00');

    await setAmount(rmbInput(), '10.5');
    expect(rmbInput().value).toBe('10.5');
    expect(ngnInput().value).toBe('2100.00');

    await setAmount(ngnInput(), '0');
    expect(ngnInput().value).toBe('0');
    expect(rmbInput().value).toBe('0.00');

    await setAmount(ngnInput(), '');
    expect(ngnInput().value).toBe('');
    expect(rmbInput().value).toBe('');

    await setAmount(ngnInput(), '100.');
    expect(ngnInput().value).toBe('100.');
    expect(rmbInput().value).toBe('0.50');
  });

  it('rounds the derived amount and does not write that rounding back into the source', async () => {
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: 3 }));
    await setAmount(ngnInput(), '100');
    expect(rmbInput().value).toBe('33.33');
    expect(ngnInput().value).toBe('100');

    await setAmount(ngnInput(), '100.10');
    expect(ngnInput().value).toBe('100.10');
    expect(rmbInput().value).toBe('33.37');
  });

  it('recomputes from the same typed amount when a new published rate arrives', async () => {
    let published = 200;
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: published }));
    await setAmount(ngnInput(), '100');
    expect(rmbInput().value).toBe('0.50');
    expect(ngnInput().value).toBe('100');

    published = 250;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(rateText()).toBe('1 RMB = ₦250');
    expect(ngnInput().value).toBe('100');
    expect(rmbInput().value).toBe('0.40');
  });

  it('rejects invalid, negative, and extra-decimal input without replacing the draft', async () => {
    await renderCalculator(() => Promise.resolve({ status: 'ready', rate: 200 }));
    await setAmount(ngnInput(), '12a');
    expect(ngnInput().value).toBe('');
    expect(rmbInput().value).toBe('');

    await setAmount(ngnInput(), '-5');
    expect(ngnInput().value).toBe('');

    await setAmount(ngnInput(), '1.23');
    expect(ngnInput().value).toBe('1.23');
    expect(rmbInput().value).toBe('0.01');
    await setAmount(ngnInput(), '1.234');
    expect(ngnInput().value).toBe('1.23');
    expect(rmbInput().value).toBe('0.01');
  });
});
