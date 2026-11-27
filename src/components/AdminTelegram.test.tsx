import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminTelegram from './AdminTelegram';
import { loadTelegramAdminPage, telegramAdmin } from '../lib/telegramAdminClient';

vi.mock('../lib/telegramAdminClient', () => ({
  loadTelegramAdminPage: vi.fn(async () => ({
    status: {
      status: 200,
      body: {
        status: 'enabled',
        note: 'Only status sent means delivered to Telegram. queued, sending, failed, needs_review, cancelled, preview, and stored are not delivered.',
        subsystems: { webhook: 'ready', alerts: 'ready', broadcast: 'ready', worker: 'missing_worker_secret' },
      },
    },
    tickets: { status: 200, body: { tickets: [] } },
    alerts: {
      status: 200,
      body: {
        alerts: [
          {
            id: 'alert-1',
            kind: 'exchange_request',
            recordKey: 'KMX-123456',
            status: 'queued',
            attempts: 0,
            lastError: null,
          },
        ],
      },
    },
    broadcasts: { status: 200, body: { broadcasts: [] } },
  })),
  telegramAdmin: vi.fn(async (op: { op: string }) => {
    if (op.op === 'preview-rate') {
      return {
        status: 200,
        body: {
          preview: {
            id: '11111111-1111-4111-8111-111111111111',
            status: 'preview',
            body: 'KoolMovez published rate\n1 RMB = ₦210',
            lastError: null,
          },
        },
      };
    }
    return { status: 200, body: {} };
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe('AdminTelegram', () => {
  it('shows a queued alert as not delivered and does not publish on load', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AdminTelegram />
        </MemoryRouter>,
      );
    });
    expect(container.textContent).toContain('Saving a changed rate on the exchange admin page posts it here immediately.');
    expect(container.textContent).not.toContain('Saving the website rate does not post it');
    expect(container.textContent).toContain('Automatic send queued. Not delivered.');
    expect(container.textContent).not.toContain('Delivered to Telegram');
    expect(loadTelegramAdminPage).toHaveBeenCalledTimes(1);
    expect(telegramAdmin).not.toHaveBeenCalled();

    const preview = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Preview channel message');
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(telegramAdmin).toHaveBeenCalledWith({ op: 'preview-rate' });
    expect(container.textContent).toContain('Preview only. Not delivered.');
    const confirm = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Publish this preview'),
    );
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(telegramAdmin).toHaveBeenCalledWith({
      op: 'confirm-rate',
      previewId: '11111111-1111-4111-8111-111111111111',
    });
  });
});
