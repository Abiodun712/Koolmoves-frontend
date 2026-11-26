import { type SupabaseClient } from '@supabase/supabase-js';
import { LEASE_MS } from './policy.js';
import type { BusinessRecord, PublishedRateRead } from './business.js';
import {
  EXCHANGE_ALERT_COLUMNS,
  LOGISTICS_ALERT_COLUMNS,
  RATE_COLUMNS,
  parseExchangeRow,
  parseLogisticsRow,
  readRateValue,
} from './business.js';
import { alertIdentity } from './policy.js';
import type {
  AlertKind,
  AlertRow,
  BroadcastRow,
  DeliveryPatch,
  DeliveryStatus,
  RecentError,
  StatusCounts,
  SupportMessage,
  TelegramStore,
  Ticket,
} from './store.js';

type Row = Record<string, unknown>;

const STATUSES = new Set<DeliveryStatus>([
  'stored',
  'preview',
  'queued',
  'sending',
  'sent',
  'failed',
  'needs_review',
  'cancelled',
]);

export function createSupabaseTelegramStore(admin: SupabaseClient): TelegramStore {
  return {
    async recordUpdate(updateId, kind, chatId) {
      const { error } = await admin.from('telegram_updates').insert({
        update_id: updateId,
        kind,
        chat_id: chatId,
        state: 'open',
      });
      if (duplicate(error)) return 'exists';
      assertOk(error);
      return 'inserted';
    },
    async finishUpdate(updateId) {
      const { error } = await admin.from('telegram_updates').update({ state: 'done' }).eq('update_id', updateId);
      assertOk(error);
    },
    async updateIsOpen(updateId) {
      const { data, error } = await admin.from('telegram_updates').select('state').eq('update_id', updateId).maybeSingle();
      assertOk(error);
      return text(data?.state) === 'open';
    },
    async rateLimit(bucket, now, limit, windowMs) {
      const { error: deleteError } = await admin
        .from('telegram_rate_events')
        .delete()
        .lt('created_at', new Date(now - windowMs * 5).toISOString());
      assertOk(deleteError);
      const { count, error } = await admin
        .from('telegram_rate_events')
        .select('id', { count: 'exact', head: true })
        .eq('bucket_key', bucket)
        .gte('created_at', new Date(now - windowMs).toISOString());
      assertOk(error);
      if ((count ?? 0) >= limit) return false;
      const inserted = await admin.from('telegram_rate_events').insert({ bucket_key: bucket });
      assertOk(inserted.error);
      return true;
    },
    async openTicket(chatId) {
      const { data, error } = await admin
        .from('telegram_support_tickets')
        .select('*')
        .eq('chat_id', chatId)
        .eq('status', 'open')
        .limit(1);
      assertOk(error);
      const first = rows(data)[0];
      return first ? mapTicket(first) : null;
    },
    async createTicket(input) {
      const { data, error } = await admin
        .from('telegram_support_tickets')
        .insert({
          chat_id: input.chatId,
          telegram_user_id: input.telegramUserId,
          status: 'open',
          created_from_update_id: input.updateId,
          created_at: iso(input.now),
          updated_at: iso(input.now),
        })
        .select('*');
      if (duplicate(error)) return 'exists';
      assertOk(error);
      const row = rows(data)[0];
      if (!row) throw storage();
      return mapTicket(row);
    },
    async addCustomerMessage(input) {
      const ticket = await this.getTicket(input.ticketId);
      if (!ticket || ticket.status !== 'open' || ticket.chatId !== input.chatId) return 'forbidden';
      const { error } = await admin.from('telegram_support_messages').insert({
        ticket_id: ticket.id,
        chat_id: ticket.chatId,
        direction: 'inbound',
        body: input.body,
        telegram_update_id: input.updateId,
        status: 'stored',
        created_at: iso(input.now),
      });
      if (duplicate(error)) return 'duplicate';
      assertOk(error);
      await touchTicket(admin, ticket.id, input.now);
      return 'created';
    },
    async listTickets() {
      const { data, error } = await admin
        .from('telegram_support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      assertOk(error);
      return rows(data).map(mapTicket);
    },
    async getTicket(ticketId) {
      const { data, error } = await admin.from('telegram_support_tickets').select('*').eq('id', ticketId).maybeSingle();
      assertOk(error);
      return data ? mapTicket(asRow(data)) : null;
    },
    async listMessages(ticketId) {
      const { data, error } = await admin
        .from('telegram_support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })
        .limit(100);
      assertOk(error);
      return rows(data).map(mapMessage);
    },
    async closeTicket(ticketId, now) {
      const { data, error } = await admin
        .from('telegram_support_tickets')
        .update({ status: 'closed', updated_at: iso(now) })
        .eq('id', ticketId)
        .eq('status', 'open')
        .select('id');
      assertOk(error);
      return rows(data).length > 0;
    },
    async queueReply(input) {
      const ticket = await this.getTicket(input.ticketId);
      if (!ticket || ticket.status !== 'open') return null;
      const { data, error } = await admin
        .from('telegram_support_messages')
        .insert({
          ticket_id: ticket.id,
          chat_id: ticket.chatId,
          direction: 'outbound',
          body: input.body,
          status: 'queued',
          author_admin_id: input.adminUserId,
          created_at: iso(input.now),
        })
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      if (!row) throw storage();
      await touchTicket(admin, ticket.id, input.now);
      return mapMessage(row);
    },
    async claimReply(id, now) {
      return claimMessage(admin, id, now);
    },
    async claimNextReply(now) {
      const { data, error } = await admin
        .from('telegram_support_messages')
        .select('*')
        .eq('direction', 'outbound')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(10);
      assertOk(error);
      for (const row of rows(data)) {
        const current = mapMessage(row);
        if (current.nextAttemptAt != null && current.nextAttemptAt > now) continue;
        const claimed = await claimMessage(admin, current.id, now);
        if (claimed) return claimed;
      }
      return null;
    },
    async settleReply(id, patch) {
      const { data, error } = await admin
        .from('telegram_support_messages')
        .update(messagePatch(patch))
        .eq('id', id)
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapMessage(row) : null;
    },
    async enqueueAlert(input) {
      const { error } = await admin.from('telegram_alert_outbox').insert({
        dedupe_key: input.dedupeKey,
        kind: input.kind,
        record_key: input.recordKey,
        status: 'queued',
        next_attempt_at: input.notBefore == null ? null : iso(input.notBefore),
        created_at: iso(input.now),
        updated_at: iso(input.now),
      });
      if (duplicate(error)) return 'exists';
      assertOk(error);
      return 'created';
    },
    async listAlerts() {
      const { data, error } = await admin
        .from('telegram_alert_outbox')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      assertOk(error);
      return rows(data).map(mapAlert);
    },
    async claimAlert(now) {
      const { data, error } = await admin
        .from('telegram_alert_outbox')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(20);
      assertOk(error);
      const ready = rows(data)
        .map(mapAlert)
        .filter((alert) => alert.nextAttemptAt == null || alert.nextAttemptAt <= now)
        .sort((a, b) => a.attempts - b.attempts || a.createdAt - b.createdAt);
      for (const current of ready) {
        const claimed = await claimAlertRow(admin, current, now);
        if (claimed) return claimed;
      }
      return null;
    },
    async claimAlertByKey(dedupeKey, now) {
      const { data, error } = await admin.from('telegram_alert_outbox').select('*').eq('dedupe_key', dedupeKey).maybeSingle();
      assertOk(error);
      if (!data) return null;
      const current = mapAlert(asRow(data));
      if (current.status !== 'queued') return null;
      if (current.nextAttemptAt != null && current.nextAttemptAt > now) return null;
      return claimAlertRow(admin, current, now);
    },
    async dispatchConfigured() {
      const { data, error } = await admin.from('telegram_dispatch_config').select('enabled').eq('id', 1).maybeSingle();
      if (error || !data || typeof data !== 'object') return false;
      return Reflect.get(data, 'enabled') === true;
    },
    async settleAlert(id, patch) {
      const { data, error } = await admin
        .from('telegram_alert_outbox')
        .update({
          ...messagePatch(patch),
          delivered_chat_ids: patch.deliveredChatIds ?? [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapAlert(row) : null;
    },
    async requeueAlert(id) {
      const { data, error } = await admin
        .from('telegram_alert_outbox')
        .update({
          status: 'queued',
          attempts: 0,
          next_attempt_at: null,
          claimed_at: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .in('status', ['needs_review', 'failed'])
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapAlert(row) : null;
    },
    async createPreview(input) {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .insert({
          status: 'preview',
          body: input.body,
          rate_line: input.rateLine,
          rate_snapshot: input.rateSnapshot,
          created_by: input.createdBy,
          expires_at: iso(input.expiresAt),
          created_at: iso(input.now),
          updated_at: iso(input.now),
        })
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      if (!row) throw storage();
      return mapBroadcast(row);
    },
    async getBroadcast(id) {
      const { data, error } = await admin.from('telegram_rate_broadcasts').select('*').eq('id', id).maybeSingle();
      assertOk(error);
      return data ? mapBroadcast(asRow(data)) : null;
    },
    async listBroadcasts() {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      assertOk(error);
      return rows(data).map(mapBroadcast);
    },
    async hasInFlightBroadcast() {
      const { count, error } = await admin
        .from('telegram_rate_broadcasts')
        .select('id', { count: 'exact', head: true })
        .in('status', ['queued', 'sending', 'needs_review']);
      assertOk(error);
      return (count ?? 0) > 0;
    },
    async claimPreview(id, adminUserId, now) {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .update({
          status: 'queued',
          confirmed_by: adminUserId,
          confirmed_at: iso(now),
          updated_at: iso(now),
        })
        .eq('id', id)
        .eq('status', 'preview')
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapBroadcast(row) : null;
    },
    async cancelPreview(id, errorCode, now) {
      const { error } = await admin
        .from('telegram_rate_broadcasts')
        .update({ status: 'cancelled', last_error: errorCode, updated_at: iso(now) })
        .eq('id', id)
        .eq('status', 'preview');
      assertOk(error);
    },
    async claimBroadcastSend(id, now) {
      return claimBroadcast(admin, id, now);
    },
    async claimNextBroadcast(now) {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(5);
      assertOk(error);
      for (const row of rows(data)) {
        const current = mapBroadcast(row);
        if (current.nextAttemptAt != null && current.nextAttemptAt > now) continue;
        const claimed = await claimBroadcast(admin, current.id, now);
        if (claimed) return claimed;
      }
      return null;
    },
    async settleBroadcast(id, patch) {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .update({ ...messagePatch(patch), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapBroadcast(row) : null;
    },
    async resolveBroadcast(id, resolution, now) {
      const { data, error } = await admin
        .from('telegram_rate_broadcasts')
        .update({
          status: resolution === 'posted_manually' ? 'sent' : 'cancelled',
          last_error: resolution === 'posted_manually' ? 'marked_by_admin' : 'marked_not_posted',
          claimed_at: null,
          next_attempt_at: null,
          updated_at: iso(now),
        })
        .eq('id', id)
        .eq('status', 'needs_review')
        .select('*');
      assertOk(error);
      const row = rows(data)[0];
      return row ? mapBroadcast(row) : null;
    },
    async reap(now) {
      const cutoff = new Date(now - LEASE_MS).toISOString();
      const stamp = iso(now);
      const patch = { status: 'needs_review', last_error: 'lease_expired', claimed_at: null, updated_at: stamp };
      const alerts = await admin.from('telegram_alert_outbox').update(patch).eq('status', 'sending').lt('claimed_at', cutoff);
      const replies = await admin
        .from('telegram_support_messages')
        .update(patch)
        .eq('status', 'sending')
        .eq('direction', 'outbound')
        .lt('claimed_at', cutoff);
      const broadcasts = await admin.from('telegram_rate_broadcasts').update(patch).eq('status', 'sending').lt('claimed_at', cutoff);
      assertOk(alerts.error);
      assertOk(replies.error);
      assertOk(broadcasts.error);
    },
    async counts() {
      return {
        alerts: await countByStatus(admin, 'telegram_alert_outbox'),
        replies: await countOutbound(admin),
        broadcasts: await countByStatus(admin, 'telegram_rate_broadcasts'),
      };
    },
    async recentErrors() {
      const errors: RecentError[] = [];
      errors.push(...(await errorRows(admin, 'telegram_alert_outbox', 'alert')));
      errors.push(...(await errorRows(admin, 'telegram_support_messages', 'reply')));
      errors.push(...(await errorRows(admin, 'telegram_rate_broadcasts', 'broadcast')));
      return errors.slice(0, 10);
    },
  };
}

export function createSupabaseBusiness(admin: SupabaseClient, now = () => Date.now()) {
  return {
    async load(kind: AlertKind, recordKey: string): Promise<BusinessRecord | null> {
      if (!alertIdentity(kind, recordKey)) return null;
      if (kind === 'exchange_request') {
        const { data, error } = await admin
          .from('exchange_requests')
          .select(EXCHANGE_ALERT_COLUMNS)
          .eq('reference_number', recordKey)
          .maybeSingle();
        assertOk(error);
        return parseExchangeRow(asOptionalRow(data));
      }
      if (kind !== 'logistics_request') return null;
      const { data, error } = await admin
        .from('packing_requests')
        .select(LOGISTICS_ALERT_COLUMNS)
        .eq('id', recordKey)
        .maybeSingle();
      assertOk(error);
      return parseLogisticsRow(asOptionalRow(data));
    },
    async listRecent(): Promise<BusinessRecord[]> {
      const since = new Date(now() - 7 * 86_400_000).toISOString();
      const exchanges = await admin
        .from('exchange_requests')
        .select(EXCHANGE_ALERT_COLUMNS)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      const logistics = await admin
        .from('packing_requests')
        .select(LOGISTICS_ALERT_COLUMNS)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      assertOk(exchanges.error);
      assertOk(logistics.error);
      const records: BusinessRecord[] = [];
      for (const row of rows(exchanges.data)) {
        const parsed = parseExchangeRow(row);
        if (parsed) records.push(parsed);
      }
      for (const row of rows(logistics.data)) {
        const parsed = parseLogisticsRow(row);
        if (parsed) records.push(parsed);
      }
      return records;
    },
    async readRate(): Promise<PublishedRateRead | null> {
      const { data, error } = await admin.from('site_settings').select(RATE_COLUMNS).eq('key', 'exchange_rate').maybeSingle();
      assertOk(error);
      if (!data || typeof data !== 'object') return null;
      return readRateValue(Reflect.get(data, 'value'));
    },
  };
}

async function claimMessage(admin: SupabaseClient, id: string, now: number): Promise<SupportMessage | null> {
  const existing = await admin.from('telegram_support_messages').select('*').eq('id', id).maybeSingle();
  assertOk(existing.error);
  if (!existing.data) return null;
  const current = mapMessage(asRow(existing.data));
  if (current.status !== 'queued') return null;
  const { data, error } = await admin
    .from('telegram_support_messages')
    .update({ status: 'sending', attempts: current.attempts + 1, claimed_at: iso(now) })
    .eq('id', id)
    .eq('status', 'queued')
    .eq('attempts', current.attempts)
    .select('*');
  assertOk(error);
  const row = rows(data)[0];
  return row ? mapMessage(row) : null;
}

async function claimAlertRow(admin: SupabaseClient, current: AlertRow, now: number): Promise<AlertRow | null> {
  const { data, error } = await admin
    .from('telegram_alert_outbox')
    .update({
      status: 'sending',
      attempts: current.attempts + 1,
      claimed_at: iso(now),
      updated_at: iso(now),
    })
    .eq('id', current.id)
    .eq('status', 'queued')
    .eq('attempts', current.attempts)
    .select('*');
  assertOk(error);
  const row = rows(data)[0];
  return row ? mapAlert(row) : null;
}

async function claimBroadcast(admin: SupabaseClient, id: string, now: number): Promise<BroadcastRow | null> {
  const existing = await admin.from('telegram_rate_broadcasts').select('*').eq('id', id).maybeSingle();
  assertOk(existing.error);
  if (!existing.data) return null;
  const current = mapBroadcast(asRow(existing.data));
  if (current.status !== 'queued') return null;
  const { data, error } = await admin
    .from('telegram_rate_broadcasts')
    .update({
      status: 'sending',
      attempts: current.attempts + 1,
      claimed_at: iso(now),
      updated_at: iso(now),
    })
    .eq('id', id)
    .eq('status', 'queued')
    .eq('attempts', current.attempts)
    .select('*');
  assertOk(error);
  const row = rows(data)[0];
  return row ? mapBroadcast(row) : null;
}

async function touchTicket(admin: SupabaseClient, id: string, now: number) {
  const { error } = await admin.from('telegram_support_tickets').update({ updated_at: iso(now) }).eq('id', id);
  assertOk(error);
}

async function countByStatus(admin: SupabaseClient, table: string): Promise<StatusCounts> {
  const { data, error } = await admin.from(table).select('status').limit(500);
  assertOk(error);
  const counts: StatusCounts = {};
  for (const row of rows(data)) {
    const status = text(row.status);
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

async function countOutbound(admin: SupabaseClient): Promise<StatusCounts> {
  const { data, error } = await admin.from('telegram_support_messages').select('status, direction').eq('direction', 'outbound').limit(500);
  assertOk(error);
  const counts: StatusCounts = {};
  for (const row of rows(data)) {
    const status = text(row.status);
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

async function errorRows(admin: SupabaseClient, table: string, kind: RecentError['kind']): Promise<RecentError[]> {
  const { data, error } = await admin
    .from(table)
    .select('id, status, last_error')
    .not('last_error', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(5);
  assertOk(error);
  return rows(data).flatMap((row) => {
    const id = text(row.id);
    const status = text(row.status);
    const last = text(row.last_error);
    if (!id || !status || !last) return [];
    return [{ kind, id, status, error: last }];
  });
}

function messagePatch(patch: DeliveryPatch) {
  return {
    status: patch.status,
    last_error: patch.lastError,
    next_attempt_at: patch.nextAttemptAt == null ? null : iso(patch.nextAttemptAt),
    claimed_at: patch.claimedAt == null ? null : iso(patch.claimedAt),
    telegram_message_id: patch.telegramMessageId,
    updated_at: new Date().toISOString(),
  };
}

function mapTicket(row: Row): Ticket {
  const id = requiredText(row.id);
  const chatId = requiredText(row.chat_id);
  const status = text(row.status) === 'closed' ? 'closed' : 'open';
  const createdFrom = num(row.created_from_update_id);
  const createdAt = millis(row.created_at);
  const updatedAt = millis(row.updated_at) ?? createdAt;
  if (!id || !chatId || createdFrom == null || createdAt == null || updatedAt == null) throw storage();
  return {
    id,
    chatId,
    telegramUserId: text(row.telegram_user_id),
    status,
    createdFromUpdateId: createdFrom,
    createdAt,
    updatedAt,
  };
}

function mapMessage(row: Row): SupportMessage {
  const direction = text(row.direction);
  const status = statusOf(row.status);
  const createdAt = millis(row.created_at);
  if ((direction !== 'inbound' && direction !== 'outbound') || !status || createdAt == null) throw storage();
  return {
    id: requiredText(row.id) ?? missing(),
    ticketId: requiredText(row.ticket_id) ?? missing(),
    chatId: requiredText(row.chat_id) ?? missing(),
    direction,
    body: requiredText(row.body) ?? missing(),
    telegramUpdateId: num(row.telegram_update_id),
    status,
    attempts: num(row.attempts) ?? 0,
    nextAttemptAt: millis(row.next_attempt_at),
    claimedAt: millis(row.claimed_at),
    telegramMessageId: text(row.telegram_message_id),
    authorAdminId: text(row.author_admin_id),
    lastError: text(row.last_error),
    createdAt,
  };
}

function mapAlert(row: Row): AlertRow {
  const kind = text(row.kind);
  const status = statusOf(row.status);
  const createdAt = millis(row.created_at);
  if ((kind !== 'exchange_request' && kind !== 'logistics_request') || !status || createdAt == null) throw storage();
  return {
    id: requiredText(row.id) ?? missing(),
    dedupeKey: requiredText(row.dedupe_key) ?? missing(),
    kind,
    recordKey: requiredText(row.record_key) ?? missing(),
    status,
    attempts: num(row.attempts) ?? 0,
    nextAttemptAt: millis(row.next_attempt_at),
    claimedAt: millis(row.claimed_at),
    deliveredChatIds: stringList(row.delivered_chat_ids),
    telegramMessageId: text(row.telegram_message_id),
    lastError: text(row.last_error),
    createdAt,
  };
}

function mapBroadcast(row: Row): BroadcastRow {
  const status = statusOf(row.status);
  const createdAt = millis(row.created_at);
  const expiresAt = millis(row.expires_at);
  if (!status || createdAt == null || expiresAt == null) throw storage();
  return {
    id: requiredText(row.id) ?? missing(),
    status,
    body: requiredText(row.body) ?? missing(),
    rateLine: requiredText(row.rate_line) ?? missing(),
    rateSnapshot: requiredText(row.rate_snapshot) ?? missing(),
    createdBy: requiredText(row.created_by) ?? missing(),
    confirmedBy: text(row.confirmed_by),
    confirmedAt: millis(row.confirmed_at),
    expiresAt,
    attempts: num(row.attempts) ?? 0,
    nextAttemptAt: millis(row.next_attempt_at),
    claimedAt: millis(row.claimed_at),
    telegramMessageId: text(row.telegram_message_id),
    lastError: text(row.last_error),
    createdAt,
  };
}

function statusOf(value: unknown): DeliveryStatus | null {
  return typeof value === 'string' && STATUSES.has(value as DeliveryStatus) ? (value as DeliveryStatus) : null;
}

function rows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.map(asRow);
}

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw storage();
  return value as Row;
}

function asOptionalRow(value: unknown): Row | null {
  if (value == null) return null;
  return asRow(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requiredText(value: unknown): string | null {
  return text(value);
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function millis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function duplicate(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function assertOk(error: { message?: string } | null) {
  if (error) throw storage();
}

function storage(): Error {
  return new Error('storage');
}

function missing(): never {
  throw storage();
}
