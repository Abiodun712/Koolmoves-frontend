import { createHash } from 'node:crypto';
import type { TelegramConfig } from './config.js';
import { subsystemStatus } from './config.js';
import type { TelegramClient } from './client.js';
import {
  MENU_INTRO,
  SUPPORT_ALREADY,
  SUPPORT_NOT_A_TICKET,
  SUPPORT_OPENED,
  SUPPORT_SAVED,
  TEXT_ONLY,
  broadcastBody,
  exchangeAlert,
  exchangeHelp,
  logisticsAlert,
  logisticsHelp,
  menuKeyboard,
  supportAlert,
  trackHelp,
} from './copy.js';
import {
  alertIdentity,
  AUTOMATIC_ALERT_BATCH,
  isDeliveredStatus,
  settleFanout,
  settleSingle,
  PREVIEW_TTL_MS,
  MAX_ADMIN_BYTES,
  MAX_WEBHOOK_BYTES,
} from './policy.js';
import type { AlertRow, BroadcastRow, SupportMessage, TelegramStore } from './store.js';
import { bearerToken, hostAllowed, maskChatId, publicError, requestHost, sanitizePlainText, secretEquals } from './text.js';
import type { ParsedUpdate } from './updates.js';
import { parseUpdate } from './updates.js';
import { formatPlatformRateLine } from '../../src/lib/publishedExchangeRate.js';
import type { BusinessRecord, PublishedRateRead } from './business.js';

const DELIVERY_NOTE =
  'A saved exchange, logistics, or support request starts an automatic Telegram send. Only status sent means delivered. queued, sending, failed, needs_review, cancelled, preview, and stored are not delivered. Retry undelivered is recovery, not the normal path.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TelegramDeps = {
  config: TelegramConfig | null;
  disabledReasons: string[];
  store: TelegramStore;
  telegram: TelegramClient;
  authorizeAdmin: (accessToken: string) => Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403 | 503 }>;
  now: () => number;
  loadBusinessRecord: (kind: BusinessRecord['kind'], recordKey: string) => Promise<BusinessRecord | null>;
  listRecentBusiness: () => Promise<BusinessRecord[]>;
  readPublishedRate: () => Promise<PublishedRateRead | null>;
};

export function createTelegramService(deps: TelegramDeps) {
  const { store, telegram } = deps;

  return {
    webhook(request: Request) {
      return handleWebhook(deps, request);
    },
    admin(request: Request) {
      return handleAdmin(deps, request);
    },
    worker(request: Request) {
      return handleWorker(deps, request);
    },
  };

  async function handleWebhook(input: TelegramDeps, request: Request): Promise<Response> {
    if (!input.config) return json(503, { status: 'disabled', reasons: input.disabledReasons });
    const config = input.config;
    if (request.method !== 'POST') return json(405, { error: 'method' });
    const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!secretEquals(config.webhookSecret, provided)) return json(401, { error: 'unauthorized' });
    if (!hostAllowed(requestHost(request), config.siteHost)) return json(403, { error: 'wrong_host' });
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) return json(400, { error: 'invalid_request' });

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return json(400, { error: 'invalid_request' });
    }
    if (raw.length > MAX_WEBHOOK_BYTES) return json(413, { error: 'too_large' });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid_request' });
    }
    const parsed = parseUpdate(body);
    if (parsed.type === 'invalid') return json(400, { error: 'invalid_request' });

    try {
      const ipAllowed = await store.rateLimit(`ip:${hashIp(clientIp(request))}`, input.now(), 120, 60_000);
      if (!ipAllowed) {
        await consume(parsed.updateId, parsed.type, null);
        return json(200, { ok: true, ignored: 'rate_limit' });
      }
      const recorded = await store.recordUpdate(parsed.updateId, parsed.type, chatOf(parsed), input.now());
      if (recorded === 'exists' && !(await store.updateIsOpen(parsed.updateId))) {
        return json(200, { ok: true, duplicate: true });
      }
      const chatId = chatOf(parsed);
      if (chatId) {
        const chatAllowed = await store.rateLimit(`chat:${chatId}`, input.now(), 20, 60_000);
        if (!chatAllowed) {
          await store.finishUpdate(parsed.updateId);
          return json(200, { ok: true, ignored: 'rate_limit' });
        }
      }
      const outcome = await dispatch(config, parsed);
      if (outcome === 'retry') return json(500, { error: 'temporary' });
      await store.finishUpdate(parsed.updateId);
      return json(200, { ok: true });
    } catch {
      return json(500, { error: 'temporary' });
    }
  }

  async function consume(updateId: number, kind: string, chatId: string | null) {
    await store.recordUpdate(updateId, kind, chatId, deps.now());
    await store.finishUpdate(updateId);
  }

  async function dispatch(config: TelegramConfig, parsed: ParsedUpdate): Promise<'ok' | 'retry'> {
    if (parsed.type === 'ignore') {
      if (parsed.callbackId) await answer(parsed.callbackId);
      return 'ok';
    }
    if (parsed.type === 'menu') return send(parsed.chatId, MENU_INTRO, menuKeyboard());
    if (parsed.type === 'unreadable') return send(parsed.chatId, TEXT_ONLY);
    if (parsed.type === 'callback') {
      await answer(parsed.callbackId);
      if (parsed.data === 'exchange') return send(parsed.chatId, exchangeHelp(config.siteUrl));
      if (parsed.data === 'logistics') return send(parsed.chatId, logisticsHelp(config.siteUrl));
      if (parsed.data === 'track') return send(parsed.chatId, trackHelp(config.siteUrl));
      const open = await store.openTicket(parsed.chatId);
      if (open) {
        await notifySupport(config, open.id);
        return send(parsed.chatId, SUPPORT_ALREADY);
      }
      const created = await store.createTicket({
        chatId: parsed.chatId,
        telegramUserId: parsed.userId,
        updateId: parsed.updateId,
        now: deps.now(),
      });
      if (created !== 'exists') await notifySupport(config, created.id);
      return send(parsed.chatId, created === 'exists' ? SUPPORT_ALREADY : SUPPORT_OPENED);
    }
    if (parsed.type !== 'text') return 'ok';
    const body = sanitizePlainText(parsed.text);
    if (!body) return send(parsed.chatId, TEXT_ONLY);
    const open = await store.openTicket(parsed.chatId);
    if (!open) return send(parsed.chatId, `${SUPPORT_NOT_A_TICKET}\n\n${MENU_INTRO}`, menuKeyboard());
    const saved = await store.addCustomerMessage({
      ticketId: open.id,
      chatId: parsed.chatId,
      updateId: parsed.updateId,
      body,
      now: deps.now(),
    });
    if (saved === 'forbidden') return send(parsed.chatId, SUPPORT_NOT_A_TICKET);
    return send(parsed.chatId, SUPPORT_SAVED);
  }

  async function send(
    chatId: string,
    text: string,
    markup?: ReturnType<typeof menuKeyboard>,
  ): Promise<'ok' | 'retry'> {
    try {
      const result = await telegram.sendMessage(chatId, text, markup);
      return result.classification === 'accepted' ? 'ok' : 'retry';
    } catch {
      return 'retry';
    }
  }

  async function answer(callbackId: string) {
    try {
      await telegram.answerCallback(callbackId);
    } catch {
      // The menu message is the user-visible result.
    }
  }

  async function notifySupport(config: TelegramConfig, ticketId: string) {
    const identity = alertIdentity('support_request', ticketId);
    if (!identity || config.adminChatIds.length === 0) return;
    try {
      await store.enqueueAlert({
        dedupeKey: identity.dedupeKey,
        kind: 'support_request',
        recordKey: identity.recordKey,
        now: deps.now(),
        notBefore: null,
      });
      const claimed = await store.claimAlertByKey(identity.dedupeKey, deps.now());
      if (claimed) await deliverClaimedAlert(deps, config, claimed);
    } catch {
      // The customer ticket is already stored. A failed admin alert does not undo it.
    }
  }
}

async function handleAdmin(deps: TelegramDeps, request: Request): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  const token = bearerToken(request);
  if (!token) return json(401, { error: 'unauthorized' });
  let auth: { ok: true; userId: string } | { ok: false; status: 401 | 403 | 503 };
  try {
    auth = await deps.authorizeAdmin(token);
  } catch {
    return json(503, { error: 'storage_unavailable' });
  }
  if (!auth.ok) return json(auth.status, { error: auth.status === 403 ? 'forbidden' : 'unauthorized' });
  if (!deps.config) return json(200, { status: 'disabled', reasons: deps.disabledReasons, note: DELIVERY_NOTE });
  if (!hostAllowed(requestHost(request), deps.config.siteHost)) return json(403, { error: 'wrong_host' });

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) return json(400, { error: 'invalid_request' });
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  if (raw.length > MAX_ADMIN_BYTES) return json(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const op = parseAdminOp(body);
  if (!op) return json(400, { error: 'invalid_request' });

  try {
    return await runAdmin(deps, deps.config, auth.userId, op);
  } catch {
    return json(503, { error: 'storage_unavailable' });
  }
}

async function handleWorker(deps: TelegramDeps, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method' });
  if (!deps.config) return json(503, { status: 'disabled', reasons: deps.disabledReasons });
  if (deps.config.workerSecrets.length === 0) {
    return json(503, { status: 'disabled', reasons: ['missing_worker_secret'] });
  }
  const token = bearerToken(request);
  const matched = token != null && deps.config.workerSecrets.some((secret) => secretEquals(secret, token));
  if (!matched) return json(401, { error: 'unauthorized' });
  try {
    await deps.store.reap(deps.now());
    const alerts = await deliverAlerts(deps, deps.config, AUTOMATIC_ALERT_BATCH);
    const replies = await deliverReplies(deps, 10);
    const broadcasts = deps.config.channelId ? await deliverBroadcasts(deps, deps.config, 1) : [];
    return json(200, {
      alerts: alerts.map(publicAlert),
      replies: replies.map(publicMessage),
      broadcasts: broadcasts.map(publicBroadcast),
      note: DELIVERY_NOTE,
    });
  } catch {
    return json(503, { error: 'storage_unavailable' });
  }
}

type AdminOp =
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

async function runAdmin(deps: TelegramDeps, config: TelegramConfig, adminUserId: string, op: AdminOp): Promise<Response> {
  if (op.op === 'status') return json(200, await statusPayload(deps, config));
  if (op.op === 'list-tickets') {
    const tickets = await deps.store.listTickets();
    return json(200, { tickets: tickets.map(publicTicket) });
  }
  if (op.op === 'ticket') {
    const payload = await ticketPayload(deps, op.ticketId);
    if (!payload) return json(404, { error: 'not_found' });
    return json(200, payload);
  }
  if (op.op === 'reply') return reply(deps, adminUserId, op.ticketId, op.body);
  if (op.op === 'close-ticket') {
    const closed = await deps.store.closeTicket(op.ticketId, deps.now());
    if (!closed) return json(404, { error: 'not_found' });
    return json(200, { closed: true, delivered: false });
  }
  if (op.op === 'list-alerts') {
    const alerts = await deps.store.listAlerts();
    return json(200, { alerts: alerts.map(publicAlert) });
  }
  if (op.op === 'reconcile') return json(200, await reconcile(deps));
  if (op.op === 'deliver') {
    await deps.store.reap(deps.now());
    const alerts = await deliverAlerts(deps, config, 10);
    const replies = await deliverReplies(deps, 10);
    const broadcasts = config.channelId ? await deliverBroadcasts(deps, config, 1) : [];
    return json(200, {
      alerts: alerts.map(publicAlert),
      replies: replies.map(publicMessage),
      broadcasts: broadcasts.map(publicBroadcast),
      note: DELIVERY_NOTE,
    });
  }
  if (op.op === 'retry-alerts') {
    const rows = await deps.store.listAlerts();
    let requeued = 0;
    for (const row of rows) {
      if (row.status !== 'needs_review' && row.status !== 'failed') continue;
      const next = await deps.store.requeueAlert(row.id);
      if (next) requeued += 1;
    }
    const alerts = config.adminChatIds.length > 0 ? await deliverAlerts(deps, config, 10) : [];
    return json(200, { requeued, alerts: alerts.map(publicAlert), note: DELIVERY_NOTE });
  }
  if (op.op === 'preview-rate') return previewRate(deps, config, adminUserId);
  if (op.op === 'confirm-rate') return confirmRate(deps, config, adminUserId, op.previewId);
  if (op.op === 'list-broadcasts') {
    const broadcasts = await deps.store.listBroadcasts();
    return json(200, { broadcasts: broadcasts.map(publicBroadcast) });
  }
  const resolved = await deps.store.resolveBroadcast(op.id, op.resolution, deps.now());
  if (!resolved) return json(409, { error: 'not_reviewable' });
  return json(200, { broadcast: publicBroadcast(resolved), note: DELIVERY_NOTE });
}

async function statusPayload(deps: TelegramDeps, config: TelegramConfig) {
  const [counts, errors, immediateDispatch] = await Promise.all([
    deps.store.counts(),
    deps.store.recentErrors(),
    deps.store.dispatchConfigured(),
  ]);
  return {
    status: 'enabled',
    subsystems: subsystemStatus(config, []),
    immediateDispatch: immediateDispatch ? 'ready' : 'not_configured',
    counts,
    recentErrors: errors.map((error) => ({ ...error, error: publicError(error.error) })),
    note: DELIVERY_NOTE,
  };
}

async function ticketPayload(deps: TelegramDeps, ticketId: string) {
  const ticket = await deps.store.getTicket(ticketId);
  if (!ticket) return null;
  const messages = await deps.store.listMessages(ticketId);
  return {
    ticket: publicTicket(ticket),
    messages: messages.map(publicMessage),
    note: DELIVERY_NOTE,
  };
}

async function reply(deps: TelegramDeps, adminUserId: string, ticketId: string, body: string) {
  const text = sanitizePlainText(body);
  if (!text) return json(400, { error: 'invalid_request' });
  const queued = await deps.store.queueReply({ ticketId, adminUserId, body: text, now: deps.now() });
  if (!queued) return json(404, { error: 'not_found' });
  const claimed = await deps.store.claimReply(queued.id, deps.now());
  if (!claimed) {
    const current = (await deps.store.listMessages(ticketId)).find((message) => message.id === queued.id);
    return json(200, { message: publicMessage(current ?? queued), note: DELIVERY_NOTE });
  }
  const settled = await deliverClaimedReply(deps, claimed);
  return json(200, { message: publicMessage(settled ?? claimed), note: DELIVERY_NOTE });
}

async function previewRate(deps: TelegramDeps, config: TelegramConfig, adminUserId: string) {
  const rate = await deps.readPublishedRate().catch(() => null);
  if (!rate || rate.parsed.status !== 'ready') return json(409, { error: 'rate_unavailable' });
  const line = formatPlatformRateLine(rate.parsed.rate);
  if (!line) return json(409, { error: 'rate_unavailable' });
  const row = await deps.store.createPreview({
    body: broadcastBody(config.siteUrl, line),
    rateLine: line,
    rateSnapshot: rate.raw,
    createdBy: adminUserId,
    now: deps.now(),
    expiresAt: deps.now() + PREVIEW_TTL_MS,
  });
  return json(200, { preview: publicBroadcast(row), note: DELIVERY_NOTE });
}

async function confirmRate(deps: TelegramDeps, config: TelegramConfig, adminUserId: string, previewId: string) {
  if (!config.channelId) return json(409, { error: 'missing_channel' });
  const existing = await deps.store.getBroadcast(previewId);
  if (!existing) return json(404, { error: 'not_found' });
  if (existing.status !== 'preview') return json(200, { broadcast: publicBroadcast(existing), note: DELIVERY_NOTE });
  if (existing.expiresAt <= deps.now()) {
    await deps.store.cancelPreview(existing.id, 'expired', deps.now());
    return json(409, { error: 'expired' });
  }
  if (await deps.store.hasInFlightBroadcast()) return json(409, { error: 'blocked' });
  const rate = await deps.readPublishedRate().catch(() => null);
  if (!rate || rate.parsed.status !== 'ready' || rate.raw !== existing.rateSnapshot) {
    await deps.store.cancelPreview(existing.id, 'rate_changed', deps.now());
    return json(409, { error: 'rate_changed' });
  }
  const claimed = await deps.store.claimPreview(existing.id, adminUserId, deps.now());
  if (!claimed) {
    const current = await deps.store.getBroadcast(existing.id);
    if (!current) return json(404, { error: 'not_found' });
    return json(200, { broadcast: publicBroadcast(current), note: DELIVERY_NOTE });
  }
  const delivered = await deliverBroadcastId(deps, config, claimed.id);
  return json(200, { broadcast: publicBroadcast(delivered), note: DELIVERY_NOTE });
}

async function reconcile(deps: TelegramDeps) {
  const records = await deps.listRecentBusiness();
  let created = 0;
  let existing = 0;
  let skipped = 0;
  for (const record of records) {
    const identity = alertIdentity(record.kind, record.recordKey);
    if (!identity) {
      skipped += 1;
      continue;
    }
    try {
      const result = await deps.store.enqueueAlert({
        dedupeKey: identity.dedupeKey,
        kind: record.kind,
        recordKey: identity.recordKey,
        now: deps.now(),
        notBefore: null,
      });
      if (result === 'created') created += 1;
      else existing += 1;
    } catch {
      skipped += 1;
    }
  }
  return { created, existing, skipped, delivered: false, note: DELIVERY_NOTE };
}

async function deliverAlerts(deps: TelegramDeps, config: TelegramConfig, limit: number): Promise<AlertRow[]> {
  if (config.adminChatIds.length === 0) return [];
  const rows: AlertRow[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await deps.store.claimAlert(deps.now());
    if (!claimed) break;
    rows.push(await deliverClaimedAlert(deps, config, claimed));
  }
  return rows;
}

async function alertText(deps: TelegramDeps, config: TelegramConfig, row: AlertRow): Promise<string | null> {
  if (row.kind === 'support_request') {
    const ticket = await deps.store.getTicket(row.recordKey);
    if (!ticket) return null;
    return supportAlert(config.siteUrl, ticket.id, ticket.status);
  }
  const record = await deps.loadBusinessRecord(row.kind, row.recordKey);
  if (!record) return null;
  return record.kind === 'exchange_request'
    ? exchangeAlert(config.siteUrl, record.recordKey, record.status)
    : logisticsAlert(config.siteUrl, record.recordKey, record.status, record.freightType ?? 'unknown');
}

async function deliverClaimedAlert(deps: TelegramDeps, config: TelegramConfig, row: AlertRow): Promise<AlertRow> {
  const text = await alertText(deps, config, row);
  if (!text) {
    return (
      (await deps.store.settleAlert(row.id, {
        status: 'cancelled',
        lastError: 'record_missing',
        nextAttemptAt: null,
        claimedAt: null,
        telegramMessageId: row.telegramMessageId,
        deliveredChatIds: row.deliveredChatIds,
      })) ?? row
    );
  }
  const delivered = new Set(row.deliveredChatIds);
  let sawRetryable = false;
  let sawUnknown = false;
  let sawRejected = false;
  let retryableCode: string | null = null;
  let unknownCode: string | null = null;
  let rejectedCode: string | null = null;
  let messageId = row.telegramMessageId;
  for (const chatId of config.adminChatIds) {
    if (delivered.has(chatId)) continue;
    const result = await callSend(deps, chatId, text);
    if (result.classification === 'accepted') {
      delivered.add(chatId);
      if (result.messageId) messageId = result.messageId;
    } else if (result.classification === 'retryable') {
      sawRetryable = true;
      retryableCode = result.code;
    } else if (result.classification === 'unknown') {
      sawUnknown = true;
      unknownCode = result.code;
    } else {
      sawRejected = true;
      rejectedCode = result.code;
    }
  }
  const decision = settleFanout({
    attempts: row.attempts,
    now: deps.now(),
    pending: config.adminChatIds.filter((chatId) => !delivered.has(chatId)).length,
    deliveredCount: delivered.size,
    sawRetryable,
    sawUnknown,
    sawRejected,
    retryableCode,
    unknownCode,
    rejectedCode,
  });
  return (
    (await deps.store.settleAlert(row.id, {
      status: decision.status,
      lastError: decision.error,
      nextAttemptAt: decision.nextAttemptAt,
      claimedAt: null,
      telegramMessageId: messageId,
      deliveredChatIds: [...delivered],
    })) ?? row
  );
}

async function deliverReplies(deps: TelegramDeps, limit: number): Promise<SupportMessage[]> {
  const rows: SupportMessage[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await deps.store.claimNextReply(deps.now());
    if (!claimed) break;
    const settled = await deliverClaimedReply(deps, claimed);
    if (settled) rows.push(settled);
  }
  return rows;
}

async function deliverClaimedReply(deps: TelegramDeps, row: SupportMessage): Promise<SupportMessage | null> {
  const result = await callSend(deps, row.chatId, row.body);
  const decision = settleSingle({
    attempts: row.attempts,
    now: deps.now(),
    classification: result.classification,
    code: result.code,
  });
  return deps.store.settleReply(row.id, {
    status: decision.status,
    lastError: decision.error,
    nextAttemptAt: decision.nextAttemptAt,
    claimedAt: null,
    telegramMessageId: result.messageId ?? row.telegramMessageId,
  });
}

async function deliverBroadcasts(deps: TelegramDeps, config: TelegramConfig, limit: number): Promise<BroadcastRow[]> {
  const rows: BroadcastRow[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await deps.store.claimNextBroadcast(deps.now());
    if (!claimed) break;
    const settled = await deliverClaimedBroadcast(deps, config, claimed);
    if (settled) rows.push(settled);
  }
  return rows;
}

async function deliverBroadcastId(deps: TelegramDeps, config: TelegramConfig, id: string): Promise<BroadcastRow> {
  const claimed = await deps.store.claimBroadcastSend(id, deps.now());
  if (!claimed) {
    const current = await deps.store.getBroadcast(id);
    if (!current) throw new Error('storage');
    return current;
  }
  return (await deliverClaimedBroadcast(deps, config, claimed)) ?? claimed;
}

async function deliverClaimedBroadcast(
  deps: TelegramDeps,
  config: TelegramConfig,
  row: BroadcastRow,
): Promise<BroadcastRow | null> {
  if (!config.channelId) {
    return deps.store.settleBroadcast(row.id, {
      status: 'needs_review',
      lastError: 'missing_channel',
      nextAttemptAt: null,
      claimedAt: null,
      telegramMessageId: null,
    });
  }
  const result = await callSend(deps, config.channelId, row.body);
  const decision = settleSingle({
    attempts: row.attempts,
    now: deps.now(),
    classification: result.classification,
    code: result.code,
  });
  return deps.store.settleBroadcast(row.id, {
    status: decision.status,
    lastError: decision.error,
    nextAttemptAt: decision.nextAttemptAt,
    claimedAt: null,
    telegramMessageId: result.messageId,
  });
}

async function callSend(deps: TelegramDeps, chatId: string, text: string) {
  try {
    return await deps.telegram.sendMessage(chatId, text);
  } catch {
    return { classification: 'unknown' as const, messageId: null, code: 'telegram_network' };
  }
}

export async function recordBusinessAlert(
  store: TelegramStore,
  input: {
    dedupeKey: string;
    kind: BusinessRecord['kind'];
    recordKey: string;
    now: number;
    notBefore: number | null;
  },
): Promise<{ recorded: boolean }> {
  try {
    await store.enqueueAlert(input);
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

function publicTicket(ticket: { id: string; status: string; createdAt: number; updatedAt: number; chatId: string }) {
  return {
    id: ticket.id,
    status: ticket.status,
    createdAt: new Date(ticket.createdAt).toISOString(),
    updatedAt: new Date(ticket.updatedAt).toISOString(),
    chatLabel: maskChatId(ticket.chatId),
  };
}

function publicMessage(message: SupportMessage) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    direction: message.direction,
    body: message.body,
    status: message.status,
    delivered: isDeliveredStatus(message.status),
    lastError: publicError(message.lastError),
    attempts: message.attempts,
    createdAt: new Date(message.createdAt).toISOString(),
  };
}

function publicAlert(alert: AlertRow) {
  return {
    id: alert.id,
    kind: alert.kind,
    recordKey: alert.recordKey,
    status: alert.status,
    delivered: isDeliveredStatus(alert.status),
    attempts: alert.attempts,
    lastError: publicError(alert.lastError),
  };
}

function publicBroadcast(row: BroadcastRow) {
  return {
    id: row.id,
    status: row.status,
    delivered: isDeliveredStatus(row.status),
    body: row.body,
    rateLine: row.rateLine,
    lastError: publicError(row.lastError),
    expiresAt: new Date(row.expiresAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function parseAdminOp(body: unknown): AdminOp | null {
  if (!isRecord(body) || typeof body.op !== 'string') return null;
  if (body.op === 'status' || body.op === 'list-tickets' || body.op === 'list-alerts' || body.op === 'list-broadcasts') {
    return { op: body.op };
  }
  if (body.op === 'reconcile' || body.op === 'deliver' || body.op === 'retry-alerts' || body.op === 'preview-rate') {
    return { op: body.op };
  }
  if (body.op === 'ticket' || body.op === 'close-ticket') {
    return typeof body.ticketId === 'string' && UUID.test(body.ticketId) ? { op: body.op, ticketId: body.ticketId } : null;
  }
  if (body.op === 'reply') {
    return typeof body.ticketId === 'string' && UUID.test(body.ticketId) && typeof body.body === 'string'
      ? { op: 'reply', ticketId: body.ticketId, body: body.body }
      : null;
  }
  if (body.op === 'confirm-rate') {
    return typeof body.previewId === 'string' && UUID.test(body.previewId)
      ? { op: 'confirm-rate', previewId: body.previewId }
      : null;
  }
  if (body.op === 'resolve-broadcast') {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return null;
    if (body.resolution !== 'not_posted' && body.resolution !== 'posted_manually') return null;
    return { op: 'resolve-broadcast', id: body.id, resolution: body.resolution };
  }
  return null;
}

function chatOf(parsed: ParsedUpdate): string | null {
  if (parsed.type === 'menu' || parsed.type === 'text' || parsed.type === 'callback' || parsed.type === 'unreadable') {
    return parsed.chatId;
  }
  return null;
}

function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 200);
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || 'unknown').slice(0, 200);
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
