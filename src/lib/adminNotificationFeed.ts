import {
  type AdminNotification,
  type AdminNotificationLoad,
  loadAdminExchangeNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  notificationArrivals,
  subscribeAdminNotificationChanges,
} from './adminExchangeNotification';

export type AdminNotificationSnapshot = AdminNotificationLoad & { ready: boolean };

type FeedListener = {
  onSnapshot: (snapshot: AdminNotificationSnapshot) => void;
  onArrival?: (items: AdminNotification[]) => void;
};

const listeners = new Set<FeedListener>();
let snapshot: AdminNotificationSnapshot = {
  items: [],
  unavailable: false,
  error: null,
  ready: false,
};
let previous: AdminNotification[] | null = null;
let pollTimer: number | null = null;
let stopRealtime: (() => void) | null = null;
let pullSeq = 0;
const DEFAULT_POLL_MS = 20000;

function publish(next: AdminNotificationSnapshot, arrivals: AdminNotification[]) {
  snapshot = next;
  for (const listener of listeners) {
    listener.onSnapshot(snapshot);
    if (arrivals.length) listener.onArrival?.(arrivals);
  }
}

export async function refreshAdminNotificationFeed(): Promise<void> {
  const seq = ++pullSeq;
  let next: AdminNotificationSnapshot;
  try {
    const loaded = await loadAdminExchangeNotifications();
    next = { ...loaded, ready: true };
  } catch (err) {
    next = {
      items: snapshot.items,
      unavailable: false,
      error: err instanceof Error ? err.message : 'Could not load notifications',
      ready: true,
    };
  }
  if (seq !== pullSeq) return;
  const arrivals = notificationArrivals(previous, next.items);
  previous = next.items;
  publish(next, arrivals);
}

function onVisible() {
  if (document.visibilityState === 'visible') void refreshAdminNotificationFeed();
}

function ensureFeed(pollMs: number) {
  if (pollTimer != null) return;
  void refreshAdminNotificationFeed();
  stopRealtime = subscribeAdminNotificationChanges(() => {
    void refreshAdminNotificationFeed();
  });
  pollTimer = window.setInterval(() => {
    void refreshAdminNotificationFeed();
  }, pollMs);
  document.addEventListener('visibilitychange', onVisible);
}

function stopFeedIfIdle() {
  if (listeners.size > 0) return;
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  stopRealtime?.();
  stopRealtime = null;
  document.removeEventListener('visibilitychange', onVisible);
  previous = null;
  pullSeq += 1;
  snapshot = { items: [], unavailable: false, error: null, ready: false };
}

export function subscribeAdminNotificationFeed(listener: FeedListener, pollMs = DEFAULT_POLL_MS): () => void {
  listeners.add(listener);
  listener.onSnapshot(snapshot);
  ensureFeed(pollMs);
  return () => {
    listeners.delete(listener);
    stopFeedIfIdle();
  };
}

export function markAdminNotificationsReadLocally(ids: string[]) {
  if (ids.length === 0) return;
  const readAt = new Date().toISOString();
  const idSet = new Set(ids);
  const items = snapshot.items.map((item) =>
    idSet.has(item.id) && !item.read_at ? { ...item, read_at: readAt } : item,
  );
  previous = items;
  publish({ ...snapshot, items }, []);
}

export async function markAdminNotificationReadAndSync(id: string): Promise<void> {
  markAdminNotificationsReadLocally([id]);
  const ok = await markAdminNotificationRead(id);
  if (!ok) await refreshAdminNotificationFeed();
}

export async function markAllAdminNotificationsReadAndSync(ids: string[]): Promise<void> {
  markAdminNotificationsReadLocally(ids);
  const ok = await markAllAdminNotificationsRead(ids);
  if (!ok) await refreshAdminNotificationFeed();
}

export function resetAdminNotificationFeedForTests() {
  listeners.clear();
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  stopRealtime?.();
  stopRealtime = null;
  document.removeEventListener('visibilitychange', onVisible);
  previous = null;
  pullSeq += 1;
  snapshot = { items: [], unavailable: false, error: null, ready: false };
}
