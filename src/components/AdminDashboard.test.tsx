import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard';
import { telegramAdmin } from '../lib/telegramAdminClient';
import { RATE_SAVE_SENT, RATE_SAVE_UNCHANGED } from '../lib/publishedExchangeRate';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../lib/telegramAdminClient', () => ({
  telegramAdmin: vi.fn(async () => ({
    status: 200,
    body: {
      broadcasts: [{ status: 'sent', delivered: true, lastError: null }],
    },
  })),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => query(table),
  },
}));

type QueryState = { table: string; key: string | null; upserted: string | null };

function query(table: string) {
  const state: QueryState = { table, key: null, upserted: null };
  const builder = {
    select() {
      return builder;
    },
    order() {
      return builder;
    },
    eq(_column: string, value: string) {
      state.key = value;
      return builder;
    },
    upsert(payload: { value?: string }) {
      state.upserted = payload.value ?? null;
      upserts.push(state.upserted);
      return Promise.resolve({ error: null });
    },
    single() {
      if (state.key === 'exchange_rate') return Promise.resolve({ data: { value: '210' }, error: null });
      if (state.key === 'platform_status') return Promise.resolve({ data: { value: 'active' }, error: null });
      return Promise.resolve({ data: null, error: { message: 'missing' } });
    },
    then(onFulfilled: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const upserts: Array<string | null> = [];
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  upserts.length = 0;
  vi.clearAllMocks();
});

async function renderDashboard() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
  });
}

function rateInput() {
  const input = container?.querySelector('input[type="number"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('rate input missing');
  return input;
}

async function setRate(value: string) {
  const input = rateInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('AdminDashboard exchange rate', () => {
  it('posts a changed rate immediately and does not post the same rate again', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    await renderDashboard();
    expect(container?.textContent).toContain('posts that rate to the Telegram channel immediately');
    expect(container?.textContent).not.toContain('does not post the rate to Telegram');
    expect(rateInput().value).toBe('210');

    await setRate('211');
    const save = [...(container?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Save Rate');
    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(upserts).toEqual(['211']);
    expect(telegramAdmin).toHaveBeenCalledTimes(1);
    expect(telegramAdmin).toHaveBeenCalledWith({ op: 'publish-saved-rate', previous: '210' });
    expect(window.alert).toHaveBeenCalledWith(RATE_SAVE_SENT);

    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(upserts).toEqual(['211', '211']);
    expect(telegramAdmin).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(RATE_SAVE_UNCHANGED);
  });
});
