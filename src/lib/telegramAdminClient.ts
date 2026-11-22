import { supabase } from './supabaseClient';

export const TELEGRAM_PAGE_LOAD_OPS = ['status', 'list-tickets', 'list-alerts', 'list-broadcasts'] as const;

export type TelegramOp =
  | { op: 'status' }
  | { op: 'list-tickets' }
  | { op: 'ticket'; ticketId: string }
  | { op: 'reply'; ticketId: string; body: string }
  | { op: 'close-ticket'; ticketId: string }
  | { op: 'list-alerts' }
  | { op: 'reconcile' }
  | { op: 'deliver' }
  | { op: 'retry-alerts' }
  | { op: 'preview-rate' }
  | { op: 'confirm-rate'; previewId: string }
  | { op: 'list-broadcasts' }
  | { op: 'resolve-broadcast'; id: string; resolution: 'not_posted' | 'posted_manually' };

export async function telegramAdmin<T>(op: TelegramOp, fetchImpl: typeof fetch = fetch): Promise<{ status: number; body: T }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 401, body: { error: 'unauthorized' } as T };
  const response = await fetchImpl('/api/telegram-admin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(op),
  });
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    body = { error: 'invalid_response' } as T;
  }
  return { status: response.status, body };
}

/** Reads only. Publishing, delivery, and replies are separate button actions. */
export async function loadTelegramAdminPage(fetchImpl: typeof fetch = fetch) {
  const [status, tickets, alerts, broadcasts] = await Promise.all(
    TELEGRAM_PAGE_LOAD_OPS.map((op) => telegramAdmin({ op }, fetchImpl)),
  );
  return { status, tickets, alerts, broadcasts };
}
