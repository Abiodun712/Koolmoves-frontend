import { randomUUID } from 'node:crypto';
import { LEASE_MS } from './policy';
import type {
  AlertRow,
  BroadcastRow,
  DeliveryPatch,
  DeliveryStatus,
  RecentError,
  StatusCounts,
  SupportMessage,
  TelegramStore,
  Ticket,
} from './store';

export function createMemoryTelegramStore(): TelegramStore {
  const updates = new Map<number, { kind: string; chatId: string | null; state: 'open' | 'done' }>();
  const buckets = new Map<string, number[]>();
  const tickets: Ticket[] = [];
  const messages: SupportMessage[] = [];
  const alerts: AlertRow[] = [];
  const broadcasts: BroadcastRow[] = [];

  function copyTicket(row: Ticket): Ticket {
    return { ...row };
  }
  function copyMessage(row: SupportMessage): SupportMessage {
    return { ...row };
  }
  function copyAlert(row: AlertRow): AlertRow {
    return { ...row, deliveredChatIds: [...row.deliveredChatIds] };
  }
  function copyBroadcast(row: BroadcastRow): BroadcastRow {
    return { ...row };
  }

  function claimById<T extends { id: string; status: DeliveryStatus; attempts: number; claimedAt: number | null }>(
    rows: T[],
    id: string,
    now: number,
  ): T | null {
    const row = rows.find((item) => item.id === id && item.status === 'queued');
    if (!row) return null;
    row.status = 'sending';
    row.attempts += 1;
    row.claimedAt = now;
    return row;
  }

  function claimNext<T extends { status: DeliveryStatus; attempts: number; claimedAt: number | null; nextAttemptAt: number | null }>(
    rows: T[],
    now: number,
  ): T | null {
    const row = rows.find(
      (item) => item.status === 'queued' && (item.nextAttemptAt == null || item.nextAttemptAt <= now),
    );
    if (!row) return null;
    row.status = 'sending';
    row.attempts += 1;
    row.claimedAt = now;
    return row;
  }

  function applyPatch(row: {
    status: DeliveryStatus;
    lastError: string | null;
    nextAttemptAt: number | null;
    claimedAt: number | null;
    telegramMessageId: string | null;
    deliveredChatIds?: string[];
  }, patch: DeliveryPatch) {
    row.status = patch.status;
    row.lastError = patch.lastError;
    row.nextAttemptAt = patch.nextAttemptAt;
    row.claimedAt = patch.claimedAt;
    row.telegramMessageId = patch.telegramMessageId;
    if (patch.deliveredChatIds && row.deliveredChatIds) row.deliveredChatIds = [...patch.deliveredChatIds];
  }

  return {
    async recordUpdate(updateId, kind, chatId) {
      if (updates.has(updateId)) return 'exists';
      updates.set(updateId, { kind, chatId, state: 'open' });
      return 'inserted';
    },
    async finishUpdate(updateId) {
      const row = updates.get(updateId);
      if (row) row.state = 'done';
    },
    async updateIsOpen(updateId) {
      return updates.get(updateId)?.state === 'open';
    },
    async rateLimit(bucket, now, limit, windowMs) {
      const recent = (buckets.get(bucket) ?? []).filter((stamp) => now - stamp < windowMs);
      if (recent.length >= limit) {
        buckets.set(bucket, recent.slice(-limit));
        return false;
      }
      recent.push(now);
      buckets.set(bucket, recent);
      return true;
    },
    async openTicket(chatId) {
      const row = tickets.find((ticket) => ticket.chatId === chatId && ticket.status === 'open');
      return row ? copyTicket(row) : null;
    },
    async createTicket(input) {
      if (tickets.some((ticket) => ticket.chatId === input.chatId && ticket.status === 'open')) return 'exists';
      if (tickets.some((ticket) => ticket.createdFromUpdateId === input.updateId)) return 'exists';
      const row: Ticket = {
        id: randomUUID(),
        chatId: input.chatId,
        telegramUserId: input.telegramUserId,
        status: 'open',
        createdFromUpdateId: input.updateId,
        createdAt: input.now,
        updatedAt: input.now,
      };
      tickets.push(row);
      return copyTicket(row);
    },
    async addCustomerMessage(input) {
      const ticket = tickets.find((item) => item.id === input.ticketId);
      if (!ticket || ticket.status !== 'open' || ticket.chatId !== input.chatId) return 'forbidden';
      if (messages.some((message) => message.telegramUpdateId === input.updateId)) return 'duplicate';
      messages.push({
        id: randomUUID(),
        ticketId: ticket.id,
        chatId: ticket.chatId,
        direction: 'inbound',
        body: input.body,
        telegramUpdateId: input.updateId,
        status: 'stored',
        attempts: 0,
        nextAttemptAt: null,
        claimedAt: null,
        telegramMessageId: null,
        authorAdminId: null,
        lastError: null,
        createdAt: input.now,
      });
      ticket.updatedAt = input.now;
      return 'created';
    },
    async listTickets() {
      return tickets.map(copyTicket).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    },
    async getTicket(ticketId) {
      const row = tickets.find((ticket) => ticket.id === ticketId);
      return row ? copyTicket(row) : null;
    },
    async listMessages(ticketId) {
      return messages.filter((message) => message.ticketId === ticketId).map(copyMessage);
    },
    async closeTicket(ticketId, now) {
      const ticket = tickets.find((item) => item.id === ticketId && item.status === 'open');
      if (!ticket) return false;
      ticket.status = 'closed';
      ticket.updatedAt = now;
      return true;
    },
    async queueReply(input) {
      const ticket = tickets.find((item) => item.id === input.ticketId && item.status === 'open');
      if (!ticket) return null;
      const row: SupportMessage = {
        id: randomUUID(),
        ticketId: ticket.id,
        chatId: ticket.chatId,
        direction: 'outbound',
        body: input.body,
        telegramUpdateId: null,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        claimedAt: null,
        telegramMessageId: null,
        authorAdminId: input.adminUserId,
        lastError: null,
        createdAt: input.now,
      };
      messages.push(row);
      ticket.updatedAt = input.now;
      return copyMessage(row);
    },
    async claimReply(id, now) {
      const row = claimById(messages, id, now);
      return row ? copyMessage(row) : null;
    },
    async claimNextReply(now) {
      const outbound = messages.filter((message) => message.direction === 'outbound');
      const row = claimNext(outbound, now);
      return row ? copyMessage(row) : null;
    },
    async settleReply(id, patch) {
      const row = messages.find((message) => message.id === id);
      if (!row) return null;
      applyPatch(row, patch);
      return copyMessage(row);
    },
    async enqueueAlert(input) {
      if (alerts.some((alert) => alert.dedupeKey === input.dedupeKey)) return 'exists';
      alerts.push({
        id: randomUUID(),
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        recordKey: input.recordKey,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: input.notBefore,
        claimedAt: null,
        deliveredChatIds: [],
        telegramMessageId: null,
        lastError: null,
        createdAt: input.now,
      });
      return 'created';
    },
    async listAlerts() {
      return alerts.map(copyAlert).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    },
    async claimAlert(now) {
      const row = claimNext(alerts, now);
      return row ? copyAlert(row) : null;
    },
    async settleAlert(id, patch) {
      const row = alerts.find((alert) => alert.id === id);
      if (!row) return null;
      applyPatch(row, patch);
      return copyAlert(row);
    },
    async requeueAlert(id) {
      const row = alerts.find((alert) => alert.id === id && (alert.status === 'needs_review' || alert.status === 'failed'));
      if (!row) return null;
      row.status = 'queued';
      row.attempts = 0;
      row.nextAttemptAt = null;
      row.claimedAt = null;
      row.lastError = null;
      return copyAlert(row);
    },
    async createPreview(input) {
      const row: BroadcastRow = {
        id: randomUUID(),
        status: 'preview',
        body: input.body,
        rateLine: input.rateLine,
        rateSnapshot: input.rateSnapshot,
        createdBy: input.createdBy,
        confirmedBy: null,
        confirmedAt: null,
        expiresAt: input.expiresAt,
        attempts: 0,
        nextAttemptAt: null,
        claimedAt: null,
        telegramMessageId: null,
        lastError: null,
        createdAt: input.now,
      };
      broadcasts.push(row);
      return copyBroadcast(row);
    },
    async getBroadcast(id) {
      const row = broadcasts.find((item) => item.id === id);
      return row ? copyBroadcast(row) : null;
    },
    async listBroadcasts() {
      return broadcasts.map(copyBroadcast).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    },
    async hasInFlightBroadcast() {
      return broadcasts.some((row) => row.status === 'queued' || row.status === 'sending' || row.status === 'needs_review');
    },
    async claimPreview(id, adminUserId, now) {
      const row = broadcasts.find((item) => item.id === id && item.status === 'preview');
      if (!row) return null;
      row.status = 'queued';
      row.confirmedBy = adminUserId;
      row.confirmedAt = now;
      return copyBroadcast(row);
    },
    async cancelPreview(id, error, now) {
      const row = broadcasts.find((item) => item.id === id && item.status === 'preview');
      if (!row) return;
      row.status = 'cancelled';
      row.lastError = error;
      row.confirmedAt = now;
    },
    async claimBroadcastSend(id, now) {
      const row = claimById(broadcasts, id, now);
      return row ? copyBroadcast(row) : null;
    },
    async claimNextBroadcast(now) {
      const row = claimNext(broadcasts, now);
      return row ? copyBroadcast(row) : null;
    },
    async settleBroadcast(id, patch) {
      const row = broadcasts.find((item) => item.id === id);
      if (!row) return null;
      applyPatch(row, patch);
      return copyBroadcast(row);
    },
    async resolveBroadcast(id, resolution, now) {
      const row = broadcasts.find((item) => item.id === id && item.status === 'needs_review');
      if (!row) return null;
      row.status = resolution === 'posted_manually' ? 'sent' : 'cancelled';
      row.lastError = resolution === 'posted_manually' ? 'marked_by_admin' : 'marked_not_posted';
      row.claimedAt = null;
      row.nextAttemptAt = null;
      row.confirmedAt = row.confirmedAt ?? now;
      return copyBroadcast(row);
    },
    async reap(now) {
      const cutoff = now - LEASE_MS;
      for (const row of [...alerts, ...messages, ...broadcasts]) {
        if (row.status === 'sending' && row.claimedAt != null && row.claimedAt <= cutoff) {
          row.status = 'needs_review';
          row.lastError = 'lease_expired';
          row.claimedAt = null;
        }
      }
    },
    async counts() {
      return {
        alerts: countStatus(alerts),
        replies: countStatus(messages.filter((message) => message.direction === 'outbound')),
        broadcasts: countStatus(broadcasts),
      };
    },
    async recentErrors() {
      const errors: RecentError[] = [];
      for (const row of alerts) pushError(errors, 'alert', row);
      for (const row of messages) if (row.direction === 'outbound') pushError(errors, 'reply', row);
      for (const row of broadcasts) pushError(errors, 'broadcast', row);
      return errors.slice(0, 10);
    },
  };
}

function countStatus(rows: Array<{ status: string }>): StatusCounts {
  const counts: StatusCounts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

function pushError(
  errors: RecentError[],
  kind: RecentError['kind'],
  row: { id: string; status: string; lastError: string | null },
) {
  if (!row.lastError) return;
  errors.push({ kind, id: row.id, status: row.status, error: row.lastError });
}
