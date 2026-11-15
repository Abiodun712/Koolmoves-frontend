import { supabase } from './supabaseClient';

/** Row written when a customer submits an exchange. */
export const ADMIN_NOTIFICATIONS_TABLE = 'admin_notifications';
export const EXCHANGE_SUBMITTED_KIND = 'exchange_submitted';

export type ExchangeSubmissionNotice = {
  referenceNumber: string;
  rmbAmount?: number | null;
  nairaAmount?: number | null;
  kmId?: string | null;
  userEmail?: string | null;
};

export type AdminNotification = {
  id: string;
  kind: string;
  reference_number: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type AdminNotificationLoad = {
  items: AdminNotification[];
  unavailable: boolean;
  error: string | null;
};

export type RecordAdminNotificationResult =
  | { recorded: true; duplicate?: boolean }
  | { recorded: false; reason: string };

/**
 * Sentence stored on admin_notifications.
 * Keep this in sync with public.admin_exchange_notification_body in
 * supabase/admin_notifications.sql — the insert trigger writes the same copy.
 */
export function formatNotificationAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const asText = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(2).replace(/\.?0+$/, '');
  const [whole, frac] = asText.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function buildExchangeSubmittedNotification(input: ExchangeSubmissionNotice) {
  const referenceNumber = input.referenceNumber.trim();
  let sentence = `Exchange ${referenceNumber} submitted`;
  if (input.rmbAmount != null && Number.isFinite(input.rmbAmount)) {
    sentence += ` for ${formatNotificationAmount(input.rmbAmount)} RMB`;
  }
  const kmId = input.kmId?.trim();
  const email = input.userEmail?.trim();
  if (kmId) sentence += ` by ${kmId}`;
  else if (email) sentence += ` by ${email}`;
  let body = `${sentence}.`;
  if (input.nairaAmount != null && Number.isFinite(input.nairaAmount)) {
    body += ` Total to pay: ₦${formatNotificationAmount(input.nairaAmount)}.`;
  }
  return {
    kind: EXCHANGE_SUBMITTED_KIND,
    reference_number: referenceNumber,
    title: 'New exchange request',
    body,
  };
}

export function unreadAdminNotifications(items: AdminNotification[]): AdminNotification[] {
  return items.filter((item) => !item.read_at);
}

/** First snapshot is a load, not a live arrival. Later ids are new notifications. */
export function notificationArrivals(
  previous: AdminNotification[] | null,
  next: AdminNotification[],
): AdminNotification[] {
  if (previous === null) return [];
  const seen = new Set(previous.map((item) => item.id));
  return next.filter((item) => !seen.has(item.id));
}

export function formatNotificationAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Recently';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 'Recently';
  const mins = Math.floor((now - time) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isDuplicateInsert(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '');
}

export function isMissingNotificationsTable(message: string): boolean {
  return /schema cache|could not find the table|does not exist|relation .*admin_notifications/i.test(message);
}

/**
 * Best-effort insert. Never throws.
 * A unique conflict means the row is already there (database trigger or a retry).
 */
export async function recordAdminExchangeNotification(
  input: ExchangeSubmissionNotice,
): Promise<RecordAdminNotificationResult> {
  try {
    const notice = buildExchangeSubmittedNotification(input);
    if (!notice.reference_number) {
      return { recorded: false, reason: 'missing reference' };
    }

    const { error } = await supabase.from(ADMIN_NOTIFICATIONS_TABLE).insert({
      kind: notice.kind,
      reference_number: notice.reference_number,
      title: notice.title,
      body: notice.body,
    });
    if (!error) return { recorded: true };
    if (isDuplicateInsert(error)) return { recorded: true, duplicate: true };
    return { recorded: false, reason: error.message || 'notification insert failed' };
  } catch (err) {
    return {
      recorded: false,
      reason: err instanceof Error ? err.message : 'notification insert failed',
    };
  }
}

export async function loadAdminExchangeNotifications(): Promise<AdminNotificationLoad> {
  try {
    const { data, error } = await supabase
      .from(ADMIN_NOTIFICATIONS_TABLE)
      .select('id, kind, reference_number, title, body, read_at, created_at')
      .eq('kind', EXCHANGE_SUBMITTED_KIND)
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      return {
        items: [],
        unavailable: isMissingNotificationsTable(error.message ?? ''),
        error: error.message || 'Could not load notifications',
      };
    }

    return {
      items: (data ?? []) as AdminNotification[],
      unavailable: false,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load notifications';
    return { items: [], unavailable: isMissingNotificationsTable(message), error: message };
  }
}

export async function markAdminNotificationRead(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(ADMIN_NOTIFICATIONS_TABLE)
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);
    return !error;
  } catch {
    return false;
  }
}

export async function markAllAdminNotificationsRead(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    const { error } = await supabase
      .from(ADMIN_NOTIFICATIONS_TABLE)
      .update({ read_at: new Date().toISOString() })
      .in('id', ids)
      .is('read_at', null);
    return !error;
  } catch {
    return false;
  }
}

/** Live insert/update events. Polling still runs if Realtime is not enabled. */
export function subscribeAdminNotificationChanges(onChange: () => void): () => void {
  try {
    const channel = supabase
      .channel(`admin-notifications-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: ADMIN_NOTIFICATIONS_TABLE },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
