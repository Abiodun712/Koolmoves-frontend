import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadTelegramAdminPage, telegramAdmin } from '../lib/telegramAdminClient';
import { deliveryStatusLabel } from '../lib/telegramStatus';

type AlertRow = {
  id: string;
  kind: string;
  recordKey: string;
  status: string;
  attempts: number;
  lastError: string | null;
};

type TicketRow = {
  id: string;
  status: string;
  chatLabel: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  direction: string;
  body: string;
  status: string;
  lastError: string | null;
};

type BroadcastRow = {
  id: string;
  status: string;
  body: string;
  lastError: string | null;
};

type StatusBody = {
  status?: string;
  reasons?: string[];
  note?: string;
  error?: string;
  immediateDispatch?: string;
  subsystems?: {
    integration?: string;
    webhook?: string;
    alerts?: string;
    broadcast?: string;
    worker?: string;
    reasons?: string[];
  };
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function AdminTelegram() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [preview, setPreview] = useState<BroadcastRow | null>(null);
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const page = await loadTelegramAdminPage();
    setStatus((page.status.body ?? null) as StatusBody | null);
    const ticketBody = page.tickets.body as { tickets?: TicketRow[] };
    const alertBody = page.alerts.body as { alerts?: AlertRow[] };
    const broadcastBody = page.broadcasts.body as { broadcasts?: BroadcastRow[] };
    setTickets(asArray<TicketRow>(ticketBody?.tickets));
    setAlerts(asArray<AlertRow>(alertBody?.alerts));
    setBroadcasts(asArray<BroadcastRow>(broadcastBody?.broadcasts));
  }

  useEffect(() => {
    // The first paint reads queue status only. Preview, publish, and delivery stay on buttons.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, []);

  async function run(op: Parameters<typeof telegramAdmin>[0], done: string) {
    setBusy(true);
    setNotice(null);
    const result = await telegramAdmin<Record<string, unknown>>(op);
    setBusy(false);
    if (result.status >= 400) {
      const error = typeof result.body.error === 'string' ? result.body.error : 'request_failed';
      setNotice(`${error}. Nothing was marked delivered.`);
      return result;
    }
    setNotice(done);
    await reload();
    return result;
  }

  async function openTicket(ticketId: string) {
    setSelectedTicket(ticketId);
    const result = await telegramAdmin<{ messages?: MessageRow[]; error?: string }>({ op: 'ticket', ticketId });
    setMessages(asArray<MessageRow>(result.body.messages));
  }

  const reasons = status?.reasons ?? status?.subsystems?.reasons ?? [];
  const integration = status?.status === 'enabled' ? 'Enabled' : 'Disabled';

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 min-h-screen text-white rounded-3xl shadow-2xl border border-purple-500/30 my-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4 border-b border-purple-800/60 pb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold">Telegram</h1>
          <p className="text-sm text-purple-200 mt-1">
            Support inbox, private new-request alerts, and an approved channel rate post.
          </p>
        </div>
        <Link to="/admin" className="bg-purple-800/65 text-cyan-100 px-4 py-2 rounded-xl text-xs font-semibold border border-purple-500/30 h-fit">
          ← Exchange Admin
        </Link>
      </div>

      <section className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-purple-300 font-bold">Operational status</h2>
        <p className="text-sm">Integration: {integration}</p>
        {reasons.length > 0 ? <p className="text-sm text-amber-200">Reasons: {reasons.join(', ')}</p> : null}
        {status?.subsystems ? (
          <p className="text-xs text-slate-300">
            Webhook {status.subsystems.webhook ?? 'unknown'} · Alerts {status.subsystems.alerts ?? 'unknown'} · Channel{' '}
            {status.subsystems.broadcast ?? 'unknown'} · Worker {status.subsystems.worker ?? 'unknown'}
          </p>
        ) : null}
        <p className="text-xs text-slate-300">
          {status?.note ??
            'Only status sent means delivered to Telegram. Queued, sending, failed, and needs review are not delivered.'}
        </p>
        {notice ? <p className="text-sm text-cyan-200">{notice}</p> : null}
      </section>

      <section className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-purple-300 font-bold">New request alerts</h2>
        <p className="text-xs text-slate-300">
          {status?.immediateDispatch === 'ready'
            ? 'Exchange, logistics, and support alerts send automatically when the record is saved. This page can stay closed.'
            : 'Exchange and logistics alerts wait until automatic dispatch is configured. Support alerts still send from the bot webhook. Nothing here is delivered yet.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run({ op: 'reconcile' }, 'Missed requests were queued for automatic delivery. Not delivered yet.')} className="px-3 py-2 rounded-xl bg-slate-800 text-xs font-semibold">
            Backfill missed requests
          </button>
          <button type="button" disabled={busy} onClick={() => run({ op: 'retry-alerts' }, 'Recovery retry finished. Check each status. Only Delivered to Telegram means it arrived.')} className="px-3 py-2 rounded-xl bg-amber-700 text-xs font-semibold">
            Retry undelivered alerts
          </button>
        </div>
        <ul className="space-y-2">
          {alerts.length === 0 ? <li className="text-xs text-slate-400">No alerts.</li> : null}
          {alerts.map((alert) => (
            <li key={alert.id} className="text-xs border border-white/10 rounded-xl p-3">
              <p>{alert.kind} · {alert.recordKey}</p>
              <p>{deliveryStatusLabel(alert.status, alert.lastError, alert.attempts).label}</p>
              {alert.lastError ? <p className="text-slate-400">Code: {alert.lastError}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-purple-300 font-bold">Channel rate</h2>
        <p className="text-xs text-slate-300">
          Saving the website rate does not post it. Preview, then confirm, to approve one channel message from the current published rate.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await telegramAdmin<{ preview?: BroadcastRow; error?: string }>({ op: 'preview-rate' });
            setBusy(false);
            if (result.body.preview) {
              setPreview(result.body.preview);
              setNotice(deliveryStatusLabel(result.body.preview.status, result.body.preview.lastError).label);
            } else {
              setNotice(result.body.error ?? 'Preview failed. Not delivered.');
            }
          }}
          className="px-3 py-2 rounded-xl bg-slate-800 text-xs font-semibold"
        >
          Preview channel message
        </button>
        {preview ? (
          <div className="space-y-2">
            <pre className="whitespace-pre-wrap text-xs bg-black/30 rounded-xl p-3">{preview.body}</pre>
            <p className="text-xs">{deliveryStatusLabel(preview.status, preview.lastError).label}</p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await telegramAdmin<{ broadcast?: BroadcastRow; error?: string }>({
                  op: 'confirm-rate',
                  previewId: preview.id,
                });
                setBusy(false);
                if (result.body.broadcast) {
                  setPreview(result.body.broadcast);
                  setNotice(deliveryStatusLabel(result.body.broadcast.status, result.body.broadcast.lastError).label);
                  await reload();
                } else {
                  setNotice(`${result.body.error ?? 'confirm_failed'}. Not delivered.`);
                }
              }}
              className="px-3 py-2 rounded-xl bg-emerald-700 text-xs font-semibold"
            >
              Publish this preview to the Telegram channel
            </button>
          </div>
        ) : null}
        <ul className="space-y-2">
          {broadcasts.map((row) => (
            <li key={row.id} className="text-xs border border-white/10 rounded-xl p-3 space-y-2">
              <p>{deliveryStatusLabel(row.status, row.lastError).label}</p>
              <pre className="whitespace-pre-wrap text-slate-300">{row.body}</pre>
              {row.status === 'needs_review' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="px-3 py-2 rounded-xl bg-slate-800" onClick={() => run({ op: 'resolve-broadcast', id: row.id, resolution: 'not_posted' }, 'Marked not posted. Not delivered.')}>
                    Mark as not posted
                  </button>
                  <button type="button" disabled={busy} className="px-3 py-2 rounded-xl bg-amber-800" onClick={() => run({ op: 'resolve-broadcast', id: row.id, resolution: 'posted_manually' }, 'Marked delivered by an admin. No new Telegram call was made.')}>
                    Mark as already posted
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-purple-300 font-bold">Support inbox</h2>
        <ul className="space-y-2">
          {tickets.length === 0 ? <li className="text-xs text-slate-400">No support tickets.</li> : null}
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" onClick={() => openTicket(ticket.id)} className="text-xs text-left w-full border border-white/10 rounded-xl p-3">
                {ticket.chatLabel} · {ticket.status}
              </button>
            </li>
          ))}
        </ul>
        {selectedTicket ? (
          <div className="space-y-2">
            {messages.map((message) => (
              <article key={message.id} className="text-xs border border-white/10 rounded-xl p-3">
                <p className="text-slate-400">{message.direction}</p>
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p>{deliveryStatusLabel(message.status, message.lastError).label}</p>
              </article>
            ))}
            <form
              className="flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await run({ op: 'reply', ticketId: selectedTicket, body: reply }, 'Reply processed. Check its status.');
                if (result && result.status < 400) {
                  setReply('');
                  await openTicket(selectedTicket);
                }
              }}
            >
              <input value={reply} onChange={(event) => setReply(event.target.value)} className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-xs" placeholder="Reply as text" />
              <button type="submit" disabled={busy} className="px-3 py-2 rounded-xl bg-emerald-700 text-xs font-semibold">Send reply</button>
            </form>
            <button type="button" disabled={busy} onClick={() => run({ op: 'close-ticket', ticketId: selectedTicket }, 'Ticket closed.')} className="text-xs underline">
              Close ticket
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
