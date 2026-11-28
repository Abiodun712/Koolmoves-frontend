import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeDashboard from './HomeDashboard';

const tables: Record<string, unknown[]> = {
  exchange_requests: [{
    id: 'e1',
    reference_number: 'KMX-100000',
    rmb_amount: 80,
    status: 'pending',
    created_at: '2026-11-27T11:59:00.000Z',
  }],
  packing_requests: [{
    id: 'p1',
    freight_type: 'sea',
    status: 'pending_packing',
    created_at: '2026-11-27T11:00:00.000Z',
  }],
  shipments: [],
  logistics_payments: [],
  site_settings: [],
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    profile: { full_name: 'Ada', km_id: 'KM1', email: 'ada@example.com', phone: '0801' },
  }),
}));

vi.mock('../hooks/usePwaInstall', () => ({
  usePwaInstall: () => ({ visible: false, fallbackKind: 'generic', promptInstall: async () => false }),
  pwaFallbackCopy: () => '',
}));

vi.mock('../lib/supabaseClient', () => {
  const builder = (table: string) => {
    const query = {
      select() { return query; },
      eq() { return query; },
      in() { return query; },
      order() { return query; },
      limit() {
        return Promise.resolve({ data: tables[table] ?? [], error: null });
      },
    };
    return query;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
    },
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

describe('HomeDashboard recent notifications', () => {
  it('lists a submitted exchange on the customer dashboard', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <HomeDashboard />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const section = container.querySelector('[data-testid="recent-notifications"]');
    expect(section?.textContent).toContain('Recent notifications');
    expect(section?.textContent).not.toContain('Recent Activity');
    expect(section?.textContent).toContain('Exchange KMX-100000 for 80 RMB was submitted and is pending review.');
    expect(section?.textContent).toContain('Sea Freight packing request was submitted');
  });
});
