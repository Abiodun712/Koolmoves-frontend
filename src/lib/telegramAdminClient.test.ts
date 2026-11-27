import { describe, expect, it, vi } from 'vitest';
import { loadTelegramAdminPage, TELEGRAM_PAGE_LOAD_OPS, telegramAdmin } from './telegramAdminClient';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'admin-access-token-value' } } })),
    },
  },
}));

describe('loadTelegramAdminPage', () => {
  it('reads status and queues and does not preview, confirm, or deliver', async () => {
    const ops: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      ops.push(JSON.parse(String(init?.body)).op);
      return new Response(JSON.stringify({ tickets: [], alerts: [], broadcasts: [], status: 'enabled' }), { status: 200 });
    });
    await loadTelegramAdminPage(fetchImpl);
    expect(ops).toEqual([...TELEGRAM_PAGE_LOAD_OPS]);
    expect(ops).not.toContain('preview-rate');
    expect(ops).not.toContain('confirm-rate');
    expect(ops).not.toContain('publish-saved-rate');
    expect(ops).not.toContain('deliver');
    expect(supabase.auth.getSession).toHaveBeenCalled();
  });

  it('does not call the API without a session', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null } } as never);
    const fetchImpl = vi.fn();
    const result = await telegramAdmin({ op: 'confirm-rate', previewId: '11111111-1111-4111-8111-111111111111' }, fetchImpl);
    expect(result.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
