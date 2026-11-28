import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXCHANGE_NOTIFICATION_COLUMNS,
  PACKING_NOTIFICATION_COLUMNS,
  buildCustomerNotifications,
  loadCustomerNotifications,
} from './customerNotifications';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./supabaseClient', () => {
  const builder = {
    select(columns: string) {
      calls.push(`select:${columns}`);
      return builder;
    },
    eq(column: string, value: string) {
      calls.push(`eq:${column}=${value}`);
      return builder;
    },
    in(column: string, values: string[]) {
      calls.push(`in:${column}=${values.join(',')}`);
      return builder;
    },
    order(column: string) {
      calls.push(`order:${column}`);
      return builder;
    },
    limit(count: number) {
      calls.push(`limit:${count}`);
      return builder;
    },
    then(
      resolve: (value: { data: unknown[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: [] as unknown[], error: null }).then(resolve, reject);
    },
  };
  return {
    supabase: {
      from(table: string) {
        calls.push(`from:${table}`);
        return builder;
      },
    },
  };
});

const now = Date.parse('2026-11-27T12:00:00.000Z');

describe('buildCustomerNotifications', () => {
  it('shows an exchange submission, packing, and logistics payment without account or receipt details', () => {
    const items = buildCustomerNotifications({
      exchanges: [{
        id: 'e1',
        reference_number: 'KMX-100000',
        rmb_amount: 80,
        status: 'pending',
        created_at: '2026-11-27T11:59:00.000Z',
        account_number: '1111222233',
        receipts: 'https://cdn.example/secret-receipt.png',
      }],
      packing: [{
        id: 'p1',
        freight_type: 'air',
        status: 'pending_packing',
        created_at: '2026-11-27T11:00:00.000Z',
      }],
      logisticsPayments: [{
        id: 'pay-1',
        shipment_id: 'ship-1',
        user_id: 'user-1',
        status: 'submitted',
        amount_due: 2500,
        created_at: '2026-11-27T10:00:00.000Z',
        updated_at: '2026-11-27T10:05:00.000Z',
        receipt_path: 'private/receipt.png',
      }],
      shipments: [{
        id: 's1',
        shipment_code: 'AF-9',
        freight_type: 'air',
        status: 'packing',
        user_id: 'user-1',
        km_id: 'KM1',
        created_at: '2026-11-27T09:00:00.000Z',
        updated_at: '2026-11-27T09:30:00.000Z',
      }],
    }, now);

    expect(items.map((item) => item.title)).toEqual([
      'Exchange submitted',
      'Packing request submitted',
      'Logistics payment submitted',
      'Air Freight update',
    ]);
    expect(items[0].message).toBe('Exchange KMX-100000 for 80 RMB was submitted and is pending review.');
    expect(items[1].message).toContain('Air Freight packing request was submitted');
    expect(items[2].message).toContain('was submitted and is awaiting confirmation');
    const rendered = JSON.stringify(items);
    expect(rendered).not.toContain('1111222233');
    expect(rendered).not.toContain('secret-receipt');
    expect(rendered).not.toContain('private/receipt');
    expect(rendered).toContain('AF-9: Packing.');
  });

  it('does not read updated_at for exchange or packing rows', () => {
    expect(EXCHANGE_NOTIFICATION_COLUMNS).not.toContain('updated_at');
    expect(PACKING_NOTIFICATION_COLUMNS).not.toContain('updated_at');
    expect(EXCHANGE_NOTIFICATION_COLUMNS).not.toContain('account_number');
    expect(EXCHANGE_NOTIFICATION_COLUMNS).not.toContain('receipts');
  });
});

describe('loadCustomerNotifications', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('reads only the signed-in customer rows', async () => {
    await loadCustomerNotifications({ userId: 'user-1', kmId: 'KM1' }, now);
    expect(calls).toContain('from:exchange_requests');
    expect(calls).toContain(`select:${EXCHANGE_NOTIFICATION_COLUMNS}`);
    expect(calls).toContain('eq:user_id=user-1');
    expect(calls).toContain('from:packing_requests');
    expect(calls).toContain(`select:${PACKING_NOTIFICATION_COLUMNS}`);
    expect(calls).toContain('from:shipments');
    expect(calls).toContain('eq:km_id=KM1');
    expect(calls).toContain('from:logistics_payments');
    expect(calls.filter((call) => call.startsWith('from:'))).not.toContain('from:admin_banks');
  });

  it('does not query another customer when there is no signed-in user', async () => {
    await loadCustomerNotifications({ userId: null, kmId: null }, now);
    expect(calls.filter((call) => call.startsWith('from:'))).toEqual(['from:site_settings']);
  });
});
