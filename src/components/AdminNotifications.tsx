import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type AdminNotification,
  formatNotificationAge,
  unreadAdminNotifications,
} from '../lib/adminExchangeNotification';
import {
  markAdminNotificationReadAndSync,
  markAllAdminNotificationsReadAndSync,
  subscribeAdminNotificationFeed,
  type AdminNotificationSnapshot,
} from '../lib/adminNotificationFeed';

const SETUP_HINT =
  'Admin exchange notifications need a one-time Supabase setup. In the SQL editor, run supabase/admin_notifications.sql. Submitting an exchange still works before that.';

type FeedProps = {
  pollMs?: number;
  onArrival?: (items: AdminNotification[]) => void;
};

function useAdminNotificationFeed({ pollMs = 20000, onArrival }: FeedProps) {
  const [state, setState] = useState<AdminNotificationSnapshot>({
    items: [],
    unavailable: false,
    error: null,
    ready: false,
  });
  const onArrivalRef = React.useRef(onArrival);

  useEffect(() => {
    onArrivalRef.current = onArrival;
  }, [onArrival]);

  useEffect(() => {
    return subscribeAdminNotificationFeed(
      {
        onSnapshot: setState,
        onArrival: (items) => onArrivalRef.current?.(items),
      },
      pollMs,
    );
  }, [pollMs]);

  return state;
}

function NotificationRows({
  items,
  onMarkRead,
}: {
  items: AdminNotification[];
  onMarkRead: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const unread = !item.read_at;
        const ref = item.reference_number;
        return (
          <article
            key={item.id}
            data-testid="admin-notification-item"
            data-unread={unread ? 'true' : 'false'}
            className={`rounded-xl border px-3 py-2 text-xs ${
              unread
                ? 'border-amber-400/50 bg-amber-500/10 text-amber-50'
                : 'border-purple-900/60 bg-slate-950/50 text-purple-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sm text-white">{item.title}</p>
                <p className="mt-1 leading-relaxed">{item.body}</p>
              </div>
              <span className="shrink-0 text-[10px] font-semibold text-purple-300">
                {formatNotificationAge(item.created_at)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {ref && (
                <Link
                  to={`/admin?ref=${encodeURIComponent(ref)}`}
                  className="font-mono text-[11px] font-bold text-cyan-300 underline"
                  onClick={() => onMarkRead(item.id)}
                >
                  {ref}
                </Link>
              )}
              {unread && (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-amber-200 underline"
                  onClick={() => onMarkRead(item.id)}
                >
                  Mark read
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function NotificationBody({
  state,
  onMarkRead,
  onMarkAll,
}: {
  state: AdminNotificationSnapshot;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}) {
  const unread = unreadAdminNotifications(state.items);

  if (!state.ready) {
    return <p className="text-xs text-purple-300">Loading notifications...</p>;
  }

  if (state.unavailable) {
    return (
      <p data-testid="admin-notification-setup" className="text-xs leading-relaxed text-amber-100">
        {SETUP_HINT}
      </p>
    );
  }

  if (state.error && state.items.length === 0) {
    return <p className="text-xs text-rose-200">Could not load notifications. {state.error}</p>;
  }

  if (state.items.length === 0) {
    return (
      <p className="text-xs text-purple-300">
        No exchange notifications yet. A new one appears here when a customer submits an exchange.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {unread.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200">
            {unread.length} unread
          </p>
          <button
            type="button"
            data-testid="admin-notifications-mark-all"
            className="text-[11px] font-semibold text-cyan-200 underline"
            onClick={onMarkAll}
          >
            Mark all read
          </button>
        </div>
      )}
      <NotificationRows items={state.items} onMarkRead={onMarkRead} />
    </div>
  );
}

export function AdminNotificationBell({ pollMs, onArrival }: FeedProps) {
  const [open, setOpen] = useState(false);
  const onArrivalRef = React.useRef(onArrival);

  useEffect(() => {
    onArrivalRef.current = onArrival;
  }, [onArrival]);

  const handleArrival = useCallback((items: AdminNotification[]) => {
    setOpen(true);
    onArrivalRef.current?.(items);
  }, []);

  const state = useAdminNotificationFeed({
    pollMs,
    onArrival: handleArrival,
  });
  const unread = unreadAdminNotifications(state.items);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="admin-notifications-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-amber-300/40 shadow"
      >
        Notifications
        <span className="sr-only" role="status" aria-live="polite">
          {unread.length > 0 ? `${unread.length} unread exchange notifications` : 'No unread exchange notifications'}
        </span>
        {unread.length > 0 && (
          <span
            data-testid="admin-notifications-badge"
            className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
          >
            {unread.length}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Exchange notifications"
          data-testid="admin-notifications-panel"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-purple-500/40 bg-slate-950 p-3 shadow-2xl text-left"
        >
          <NotificationBody
            state={state}
            onMarkRead={(id) => {
              void markAdminNotificationReadAndSync(id);
            }}
            onMarkAll={() => {
              void markAllAdminNotificationsReadAndSync(unread.map((item) => item.id));
            }}
          />
        </div>
      )}
    </div>
  );
}

export function AdminNotificationList({ pollMs, onArrival }: FeedProps) {
  const state = useAdminNotificationFeed({ pollMs, onArrival });
  const unread = unreadAdminNotifications(state.items);

  return (
    <section
      data-testid="admin-notifications-list"
      aria-live="polite"
      className="p-5 bg-slate-900/90 rounded-2xl border border-amber-500/30 shadow-xl space-y-3"
    >
      <div>
        <h2 className="text-xs uppercase tracking-wider text-amber-200 font-bold">Exchange notifications</h2>
        <p className="text-[11px] text-purple-200 mt-1">
          New customer exchange submissions show up here. This list stays after you leave and come back.
        </p>
      </div>
      <NotificationBody
        state={state}
        onMarkRead={(id) => {
          void markAdminNotificationReadAndSync(id);
        }}
        onMarkAll={() => {
          void markAllAdminNotificationsReadAndSync(unread.map((item) => item.id));
        }}
      />
    </section>
  );
}
