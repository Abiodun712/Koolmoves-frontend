import { act, type ReactElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminNotificationBell, AdminNotificationList } from './AdminNotifications';
import { resetAdminNotificationFeedForTests } from '../lib/adminNotificationFeed';

const { loadAdminExchangeNotifications, markAdminNotificationRead, markAllAdminNotificationsRead } = vi.hoisted(
  () => ({
    loadAdminExchangeNotifications: vi.fn(),
    markAdminNotificationRead: vi.fn(),
    markAllAdminNotificationsRead: vi.fn(),
  }),
);

vi.mock('../lib/adminExchangeNotification', async () => {
  const actual = await vi.importActual<typeof import('../lib/adminExchangeNotification')>(
    '../lib/adminExchangeNotification',
  );
  return {
    ...actual,
    loadAdminExchangeNotifications,
    markAdminNotificationRead,
    markAllAdminNotificationsRead,
    subscribeAdminNotificationChanges: () => () => {},
  };
});

const pending = {
  id: 'n1',
  kind: 'exchange_submitted',
  reference_number: 'KMX-123456',
  title: 'New exchange request',
  body: 'Exchange KMX-123456 submitted for 100 RMB by KM-0042. Total to pay: ₦21,000.',
  read_at: null,
  created_at: new Date().toISOString(),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Admin notifications', () => {
  beforeEach(() => {
    loadAdminExchangeNotifications.mockReset();
    markAdminNotificationRead.mockReset();
    markAllAdminNotificationsRead.mockReset();
    markAdminNotificationRead.mockResolvedValue(true);
    markAllAdminNotificationsRead.mockResolvedValue(true);
    loadAdminExchangeNotifications.mockResolvedValue({
      items: [pending],
      unavailable: false,
      error: null,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    resetAdminNotificationFeedForTests();
  });

  it('shows an unread badge and the submission in the admin list', async () => {
    await render(
      <>
        <AdminNotificationBell pollMs={60000} />
        <AdminNotificationList pollMs={60000} />
      </>,
    );

    expect(container?.querySelector('[data-testid="admin-notifications-badge"]')?.textContent).toBe('1');
    expect(container?.textContent).toContain('Exchange KMX-123456 submitted for 100 RMB by KM-0042');
    expect(container?.querySelector('[data-testid="admin-notification-item"]')?.getAttribute('data-unread')).toBe(
      'true',
    );
  });

  it('opens the panel from the header button and marks a notification read', async () => {
    await render(<AdminNotificationBell pollMs={60000} />);
    expect(container?.querySelector('[data-testid="admin-notifications-panel"]')).toBeNull();

    const button = container?.querySelector('[data-testid="admin-notifications-button"]');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const mark = Array.from(container?.querySelectorAll('button') ?? []).find((node) =>
      node.textContent?.includes('Mark read'),
    );
    await act(async () => {
      mark?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(markAdminNotificationRead).toHaveBeenCalledWith('n1');
    expect(container?.querySelector('[data-testid="admin-notifications-badge"]')).toBeNull();
  });

  it('explains the one-time SQL setup when the table is not there yet', async () => {
    loadAdminExchangeNotifications.mockResolvedValue({
      items: [],
      unavailable: true,
      error: 'relation "public.admin_notifications" does not exist',
    });
    await render(<AdminNotificationList pollMs={60000} />);
    expect(container?.querySelector('[data-testid="admin-notification-setup"]')?.textContent).toContain(
      'supabase/admin_notifications.sql',
    );
  });
});
