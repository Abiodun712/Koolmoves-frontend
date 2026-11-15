import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, select, eq, limit, from } = vi.hoisted(() => {
  const insert = vi.fn();
  const update = vi.fn();
  const limit = vi.fn();
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order, is: isFilter }));
  const isFilter = vi.fn();
  const inFilter = vi.fn(() => ({ is: isFilter }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, update, select }));
  return { insert, update, select, eq, order, limit, isFilter, inFilter, from };
});

vi.mock('./supabaseClient', () => ({
  supabase: {
    from,
    channel: vi.fn(() => {
      throw new Error('realtime unavailable');
    }),
  },
}));

import {
  buildExchangeSubmittedNotification,
  formatNotificationAge,
  formatNotificationAmount,
  isMissingNotificationsTable,
  loadAdminExchangeNotifications,
  notificationArrivals,
  recordAdminExchangeNotification,
  subscribeAdminNotificationChanges,
  unreadAdminNotifications,
} from './adminExchangeNotification';

describe('buildExchangeSubmittedNotification', () => {
  it('describes the submission with amount, KM ID, and naira total', () => {
    expect(
      buildExchangeSubmittedNotification({
        referenceNumber: ' KMX-123456 ',
        rmbAmount: 100,
        nairaAmount: 21000,
        kmId: 'KM-0042',
        userEmail: 'a@b.co',
      }),
    ).toEqual({
      kind: 'exchange_submitted',
      reference_number: 'KMX-123456',
      title: 'New exchange request',
      body: 'Exchange KMX-123456 submitted for 100 RMB by KM-0042. Total to pay: ₦21,000.',
    });
  });

  it('falls back to email and keeps a fractional naira total', () => {
    expect(
      buildExchangeSubmittedNotification({
        referenceNumber: 'KMX-1',
        rmbAmount: 50,
        nairaAmount: 10500.5,
        kmId: ' ',
        userEmail: 'a@b.co',
      }).body,
    ).toBe('Exchange KMX-1 submitted for 50 RMB by a@b.co. Total to pay: ₦10,500.5.');
  });

  it('still builds a notice when only the reference is known', () => {
    expect(
      buildExchangeSubmittedNotification({
        referenceNumber: 'KMX-1',
      }).body,
    ).toBe('Exchange KMX-1 submitted.');
  });
});

describe('formatNotificationAmount', () => {
  it('groups thousands and trims trailing zeros', () => {
    expect(formatNotificationAmount(21000)).toBe('21,000');
    expect(formatNotificationAmount(10500.5)).toBe('10,500.5');
    expect(formatNotificationAmount(100)).toBe('100');
    expect(formatNotificationAmount(0)).toBe('0');
  });
});

describe('notification helpers', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');

  it('formats relative ages', () => {
    expect(formatNotificationAge('2026-11-15T11:59:30.000Z', now)).toBe('Just now');
    expect(formatNotificationAge('2026-11-15T11:00:00.000Z', now)).toBe('1h ago');
    expect(formatNotificationAge('not-a-date', now)).toBe('Recently');
  });

  it('counts unread rows and ignores the first snapshot as an arrival', () => {
    const pending = {
      id: '1',
      kind: 'exchange_submitted',
      reference_number: 'KMX-1',
      title: 'New exchange request',
      body: 'Exchange KMX-1 submitted.',
      read_at: null,
      created_at: '2026-11-15T11:00:00.000Z',
    };
    const read = { ...pending, id: '2', read_at: '2026-11-15T11:05:00.000Z' };
    expect(unreadAdminNotifications([pending, read])).toEqual([pending]);
    expect(notificationArrivals(null, [pending])).toEqual([]);
    expect(notificationArrivals([read], [read, pending])).toEqual([pending]);
  });

  it('recognises a missing notifications table', () => {
    expect(
      isMissingNotificationsTable(
        "Could not find the table 'public.admin_notifications' in the schema cache",
      ),
    ).toBe(true);
    expect(isMissingNotificationsTable('permission denied')).toBe(false);
  });
});

describe('recordAdminExchangeNotification', () => {
  beforeEach(() => {
    insert.mockReset();
    from.mockClear();
  });

  it('inserts the exchange notice and does not throw', async () => {
    insert.mockResolvedValue({ error: null });
    await expect(
      recordAdminExchangeNotification({
        referenceNumber: 'KMX-123456',
        rmbAmount: 100,
        nairaAmount: 21000,
        kmId: 'KM-0042',
        userEmail: 'a@b.co',
      }),
    ).resolves.toEqual({ recorded: true });
    expect(from).toHaveBeenCalledWith('admin_notifications');
    expect(insert).toHaveBeenCalledWith({
      kind: 'exchange_submitted',
      reference_number: 'KMX-123456',
      title: 'New exchange request',
      body: 'Exchange KMX-123456 submitted for 100 RMB by KM-0042. Total to pay: ₦21,000.',
    });
  });

  it('treats a unique conflict as already recorded so the exchange submit can continue', async () => {
    insert.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await expect(
      recordAdminExchangeNotification({ referenceNumber: 'KMX-1' }),
    ).resolves.toEqual({ recorded: true, duplicate: true });
  });

  it('returns a failure when the table is missing and does not throw', async () => {
    insert.mockResolvedValue({
      error: {
        message: "Could not find the table 'public.admin_notifications' in the schema cache",
      },
    });
    await expect(
      recordAdminExchangeNotification({ referenceNumber: 'KMX-1' }),
    ).resolves.toEqual({
      recorded: false,
      reason: "Could not find the table 'public.admin_notifications' in the schema cache",
    });
  });

  it('does not call Supabase without a reference', async () => {
    await expect(recordAdminExchangeNotification({ referenceNumber: '  ' })).resolves.toEqual({
      recorded: false,
      reason: 'missing reference',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('catches a thrown client error', async () => {
    insert.mockRejectedValue(new Error('network down'));
    await expect(
      recordAdminExchangeNotification({ referenceNumber: 'KMX-9' }),
    ).resolves.toEqual({ recorded: false, reason: 'network down' });
  });
});

describe('loadAdminExchangeNotifications', () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    limit.mockReset();
  });

  it('reads exchange notifications newest first', async () => {
    const row = {
      id: 'n1',
      kind: 'exchange_submitted',
      reference_number: 'KMX-1',
      title: 'New exchange request',
      body: 'Exchange KMX-1 submitted.',
      read_at: null,
      created_at: '2026-11-15T11:00:00.000Z',
    };
    limit.mockResolvedValue({ data: [row], error: null });
    await expect(loadAdminExchangeNotifications()).resolves.toEqual({
      items: [row],
      unavailable: false,
      error: null,
    });
    expect(from).toHaveBeenCalledWith('admin_notifications');
    expect(select).toHaveBeenCalledWith('id, kind, reference_number, title, body, read_at, created_at');
    expect(eq).toHaveBeenCalledWith('kind', 'exchange_submitted');
    expect(limit).toHaveBeenCalledWith(40);
  });

  it('reports a missing table without throwing', async () => {
    limit.mockResolvedValue({
      data: null,
      error: { message: 'relation "public.admin_notifications" does not exist' },
    });
    await expect(loadAdminExchangeNotifications()).resolves.toEqual({
      items: [],
      unavailable: true,
      error: 'relation "public.admin_notifications" does not exist',
    });
  });
});

describe('subscribeAdminNotificationChanges', () => {
  it('still returns a cleanup when realtime cannot start', () => {
    const stop = subscribeAdminNotificationChanges(() => {});
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});
