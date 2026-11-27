import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserDashboard from './UserDashboard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { calls, inserts, rpc } = vi.hoisted(() => ({
  calls: [] as string[],
  inserts: [] as unknown[],
  rpc: vi.fn(async (name: string, args: Record<string, string>) => {
    calls.push(`rpc:${name}:${args.p_transaction_key ?? ''}:${args.p_reference ?? ''}`);
    if (name === 'request_exchange_naira_account') {
      return {
        data: [
          { bank_name: 'Shown Bank', account_name: 'KoolMovez Collections', account_number: '1111222233' },
          { bank_name: 'Hidden Bank', account_name: 'Other Collections', account_number: '9999888877' },
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  }),
}));

vi.mock('../lib/supabaseClient', () => {
  const builder = (table: string) => {
    calls.push(`from:${table}`);
    const query: Record<string, unknown> = {};
    query.select = (columns: string) => {
      calls.push(`select:${table}:${columns}`);
      return query;
    };
    query.eq = (column: string, value: string) => {
      calls.push(`eq:${table}:${column}=${value}`);
      return query;
    };
    query.in = () => query;
    query.order = () => query;
    query.insert = (payload: unknown) => {
      inserts.push(payload);
      return Promise.resolve({ error: null });
    };
    query.single = () => Promise.resolve({
      data: { km_id: 'KM9', email: 'ada@example.com', phone: '0801' },
      error: null,
    });
    query.then = (
      resolve: (value: { data: unknown[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const data = table === 'exchange_requests'
        ? inserts.map((payload) => {
            const row = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown>;
            return { ...row, id: 'saved-1', created_at: new Date().toISOString(), status: 'pending' };
          })
        : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return query;
  };
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      },
      from: (table: string) => builder(table),
      rpc,
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.example/receipt.png' } }),
        }),
      },
    },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDashboard() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<UserDashboard />);
  });
  await flush();
}

beforeEach(() => {
  calls.length = 0;
  inserts.length = 0;
  rpc.mockClear();
  sessionStorage.clear();
  vi.stubGlobal('alert', vi.fn());
});

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

describe('customer exchange Naira account', () => {
  it('keeps the receipt upload and hides every account until the button is clicked', async () => {
    await renderDashboard();
    expect(container?.textContent).toContain('Upload Proof of Payment');
    expect(container?.textContent).toContain('Request Naira account');
    expect(container?.querySelector('[data-testid="naira-account-number"]')).toBeNull();
    expect(container?.textContent).not.toContain('1111222233');
    expect(container?.textContent).not.toContain('9999888877');
    expect(container?.textContent).not.toContain('0123456789');
    expect(calls.some((call) => call.startsWith('rpc:request_exchange_naira_account'))).toBe(false);
    expect(calls).not.toContain('from:admin_banks');
    expect(container?.querySelector('input[type="file"][accept="image/*"]')).not.toBeNull();
  });

  it('reveals one account, keeps the receipt step, and saves that receipt on submit', async () => {
    await renderDashboard();
    const button = container?.querySelector('[data-testid="request-naira-account"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(container?.querySelector('[data-testid="naira-account-number"]')?.textContent).toBe('1111222233');
    expect(container?.textContent).not.toContain('9999888877');
    expect(container?.textContent).toContain('Upload Proof of Payment');

    const fileInput = container?.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const file = new File(['png'], 'naira-receipt.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: { 0: file, length: 1, item: () => file },
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(container?.textContent).toContain('Receipt image uploaded successfully');

    const amount = container?.querySelector('input[placeholder="e.g. 1000"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(amount, '100');
      amount.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container?.textContent).toContain('KM9');
    const form = container?.querySelector('form') as HTMLFormElement | null;
    await act(async () => {
      form?.requestSubmit();
    });
    await flush();
    await flush();

    const payload = (inserts[0] as Array<Record<string, unknown>>)[0];
    expect(payload.receipts).toBe('https://cdn.example/receipt.png');
    expect(payload.user_id).toBe('user-1');
    expect(String(payload.reference_number)).toMatch(/^KMX-\d{6}$/);
    expect(calls.some((call) => call.startsWith('rpc:attach_exchange_naira_account:'))).toBe(true);
    expect(calls.some((call) => call.includes(String(payload.reference_number)))).toBe(true);
    expect(container?.textContent).toContain('View Receipt');
  });

  it('shows the same account again after a refresh of that transaction', async () => {
    const transactionKey = '33333333-3333-4333-8333-333333333333';
    sessionStorage.setItem(
      'koolmovez.exchange.nairaTransaction',
      JSON.stringify({ transactionKey, revealed: true }),
    );
    await renderDashboard();
    await flush();
    expect(container?.querySelector('[data-testid="naira-account-number"]')?.textContent).toBe('1111222233');
    expect(container?.textContent).not.toContain('9999888877');
    expect(calls.some((call) => call.startsWith(`rpc:request_exchange_naira_account:${transactionKey}:`))).toBe(true);
  });
});
