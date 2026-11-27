// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TelegramCallResult, TelegramClient } from './client';
import { loadTelegramConfig, type TelegramConfig } from './config';
import {
  MENU_INTRO,
  SUPPORT_ALREADY,
  SUPPORT_NOT_A_TICKET,
  SUPPORT_OPENED,
  SUPPORT_SAVED,
  broadcastBody,
  exchangeHelp,
  logisticsHelp,
  trackHelp,
} from './copy';
import { createMemoryTelegramStore } from './memoryStore';
import { recordBusinessAlert, createTelegramService } from './service';
import type { BusinessRecord } from './business';
import type { PublishedRateRead } from './business';

const TOKEN = '123456789:AAHexampleTokenValueForTestsOnly';
const SECRET = 'test-webhook-secret-value';
const WORKER = 'test-worker-secret-value';
const ADMIN = 'admin-access-token-value';
const CUSTOMER = 'customer-access-token-value';
const HOST = 'koolmovez.com';

// Test responses are asserted field by field. The helper only removes `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJson(value: unknown): any {
  return value;
}

function testConfig(overrides: Record<string, string> = {}): TelegramConfig {
  const loaded = loadTelegramConfig({
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_SITE_URL: 'https://koolmovez.com',
    TELEGRAM_ADMIN_CHAT_IDS: '10001',
    TELEGRAM_CHANNEL_ID: '-1001234567890',
    TELEGRAM_WORKER_SECRET: WORKER,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-which-is-not-the-anon-key',
    ...overrides,
  });
  if (!loaded.ok) throw new Error(loaded.reasons.join(','));
  return loaded.config;
}

type Send = { chatId: string; text: string; replyMarkup?: unknown };

function harness(options: {
  config?: TelegramConfig | null;
  reasons?: string[];
  onSend?: (call: Send, index: number) => TelegramCallResult;
  rate?: PublishedRateRead | null;
  rateChangesInstalled?: boolean;
} = {}) {
  const store = createMemoryTelegramStore({ rateChangesInstalled: options.rateChangesInstalled });
  const calls: Send[] = [];
  const records = new Map<string, BusinessRecord>();
  let now = Date.parse('2026-11-22T12:00:00.000Z');
  let rate = options.rate === undefined ? { raw: '210', parsed: { status: 'ready' as const, rate: 210 } } : options.rate;
  const telegram: TelegramClient = {
    async sendMessage(chatId, text, replyMarkup) {
      const call = { chatId, text, replyMarkup };
      calls.push(call);
      return options.onSend?.(call, calls.length) ?? { classification: 'accepted', messageId: String(calls.length), code: null };
    },
    async answerCallback() {
      return { classification: 'accepted', messageId: null, code: null };
    },
  };
  const service = createTelegramService({
    config: options.config === undefined ? testConfig() : options.config,
    disabledReasons: options.reasons ?? ['disabled'],
    store,
    telegram,
    authorizeAdmin: async (token) => {
      if (token === ADMIN) return { ok: true, userId: '11111111-1111-4111-8111-111111111111' };
      if (token === CUSTOMER) return { ok: false, status: 403 };
      return { ok: false, status: 401 };
    },
    now: () => now,
    loadBusinessRecord: async (kind, recordKey) => records.get(`${kind}:${recordKey}`) ?? null,
    listRecentBusiness: async () => [...records.values()],
    readPublishedRate: async () => rate,
  });
  return {
    service,
    store,
    calls,
    records,
    setNow(value: number) {
      now = value;
    },
    setRate(next: PublishedRateRead | null) {
      rate = next;
    },
    now: () => now,
  };
}

function webhook(update: unknown, secret = SECRET, host = HOST) {
  return new Request('https://koolmovez.com/api/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host,
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify(update),
  });
}

function admin(op: unknown, token = ADMIN) {
  return new Request('https://koolmovez.com/api/telegram-admin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: HOST,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(op),
  });
}

function worker(token = WORKER) {
  return new Request('https://koolmovez.com/api/telegram-worker', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, host: 'cron.internal' },
  });
}

function privateMessage(updateId: number, chatId: number, text: string) {
  return { update_id: updateId, message: { text, chat: { id: chatId, type: 'private' }, from: { id: chatId } } };
}

function callback(updateId: number, chatId: number, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      data,
      from: { id: chatId },
      message: { chat: { id: chatId, type: 'private' } },
    },
  };
}

describe('telegram webhook', () => {
  it('rejects a missing configuration before any Telegram call', async () => {
    const { service, calls } = harness({ config: null, reasons: ['disabled'] });
    const response = await service.webhook(webhook(privateMessage(1, 555001, '/start')));
    expect(response.status).toBe(503);
    expect(asJson(await response.json())).toEqual({ status: 'disabled', reasons: ['disabled'] });
    expect(calls).toEqual([]);
  });

  it('rejects a forged secret and a wrong host without creating a ticket', async () => {
    const { service, calls } = harness();
    const forged = await service.webhook(webhook(callback(1, 555001, 'support'), 'wrong-secret-value-here'));
    expect(forged.status).toBe(401);
    const wrongHost = await service.webhook(webhook(callback(1, 555001, 'support'), SECRET, 'evil.example'));
    expect(wrongHost.status).toBe(403);
    const tickets = await service.admin(admin({ op: 'list-tickets' }));
    expect(asJson(await tickets.json())).toEqual({ tickets: [] });
    expect(calls).toEqual([]);
  });

  it('does not grant admin access from /start, including an allow-listed chat', async () => {
    const { service, calls } = harness();
    const configIds = testConfig().adminChatIds.slice();
    const customer = await service.webhook(webhook(privateMessage(1, 555001, '/start')));
    const adminChat = await service.webhook(webhook(privateMessage(2, 10001, '/start@KoolmovezBot')));
    expect(customer.status).toBe(200);
    expect(adminChat.status).toBe(200);
    expect(calls.map((call) => call.text)).toEqual([MENU_INTRO, MENU_INTRO]);
    expect(testConfig().adminChatIds).toEqual(configIds);
    const tickets = asJson(await (await service.admin(admin({ op: 'list-tickets' }))).json());
    expect(tickets).toEqual({ tickets: [] });
  });

  it('creates one support ticket for a retried update and keeps another chat out of it', async () => {
    const { service } = harness();
    const first = await service.webhook(webhook(callback(10, 555001, 'support')));
    const replay = await service.webhook(webhook(callback(10, 555001, 'support')));
    const again = await service.webhook(webhook(callback(11, 555001, 'support')));
    expect(first.status).toBe(200);
    expect((asJson(await replay.json())).duplicate).toBe(true);
    expect(again.status).toBe(200);
    const listed = asJson(await (await service.admin(admin({ op: 'list-tickets' }))).json());
    expect(listed.tickets).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('555001');
    expect(listed.tickets[0].chatLabel).toBe('•••5001');

    const malicious = '<b>bold</b>\n<script>alert(1)</script>\u0000*markdown*';
    await service.webhook(webhook(privateMessage(12, 555001, malicious)));
    await service.webhook(webhook(privateMessage(12, 555001, malicious)));
    await service.webhook(webhook(privateMessage(13, 555002, 'steal-this-private-note')));
    const ticket = asJson(await (await service.admin(admin({ op: 'ticket', ticketId: listed.tickets[0].id }))).json());
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0].body).toContain('<script>alert(1)</script>');
    expect(ticket.messages[0].body).not.toContain('\u0000');
    expect(ticket.messages[0].status).toBe('stored');
    expect(ticket.messages[0].delivered).toBe(false);
    expect(JSON.stringify(ticket)).not.toContain('steal-this-private-note');
  });

  it('does not echo customer text and does not enable Telegram formatting', async () => {
    const { service, calls } = harness();
    await service.webhook(webhook(callback(1, 555001, 'support')));
    await service.webhook(webhook(privateMessage(2, 555001, '<b>secret markup</b>')));
    const outbound = calls.filter((call) => call.chatId === '555001');
    expect(outbound.some((call) => call.text.includes('secret markup'))).toBe(false);
    expect(outbound.some((call) => call.text === SUPPORT_OPENED)).toBe(true);
    expect(outbound.some((call) => call.text === SUPPORT_SAVED)).toBe(true);
    expect(outbound.every((call) => call.replyMarkup == null || markupIsAllowlisted(call.replyMarkup))).toBe(true);
    expect(JSON.stringify(outbound)).not.toContain('parse_mode');
  });

  it('points Exchange, Logistics, and tracking at the existing website and does not invent a rate', async () => {
    const { service, calls } = harness();
    await service.webhook(webhook(privateMessage(1, 555001, '/help')));
    await service.webhook(webhook(callback(2, 555001, 'exchange')));
    await service.webhook(webhook(callback(3, 555001, 'logistics')));
    await service.webhook(webhook(callback(4, 555001, 'track')));
    const texts = calls.map((call) => call.text);
    expect(texts).toContain(MENU_INTRO);
    expect(texts).toContain(exchangeHelp('https://koolmovez.com'));
    expect(texts).toContain(logisticsHelp('https://koolmovez.com'));
    expect(texts).toContain(trackHelp('https://koolmovez.com'));
    expect(texts.join('\n')).not.toMatch(/guaranteed|within \d|same[- ]day|instant|\d+\s*%/i);
    expect(texts.join('\n')).not.toContain('₦');
  });

  it('ignores a second open ticket attempt and a message sent before Talk to support', async () => {
    const { service, calls } = harness();
    await service.webhook(webhook(privateMessage(1, 555001, 'hello before support')));
    expect(calls.at(-1)?.text).toContain(SUPPORT_NOT_A_TICKET);
    await service.webhook(webhook(callback(2, 555001, 'support')));
    await service.webhook(webhook(callback(3, 555001, 'support')));
    expect(calls.at(-1)?.text).toBe(SUPPORT_ALREADY);
    const listed = asJson(await (await service.admin(admin({ op: 'list-tickets' }))).json());
    expect(listed.tickets).toHaveLength(1);
  });

  it('drops a chat that exceeds the message limit without opening a ticket', async () => {
    const { service } = harness();
    for (let id = 1; id <= 20; id += 1) {
      const response = await service.webhook(webhook(privateMessage(id, 555001, '/menu')));
      expect(response.status).toBe(200);
    }
    const limited = await service.webhook(webhook(callback(21, 555001, 'support')));
    expect((asJson(await limited.json())).ignored).toBe('rate_limit');
    const listed = asJson(await (await service.admin(admin({ op: 'list-tickets' }))).json());
    expect(listed.tickets).toEqual([]);
  });

  it('rejects an oversized or malformed update', async () => {
    const { service } = harness();
    const huge = new Request('https://koolmovez.com/api/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: HOST,
        'x-telegram-bot-api-secret-token': SECRET,
      },
      body: `{"update_id":1,"message":{"text":"${'a'.repeat(70_000)}"}}`,
    });
    expect((await service.webhook(huge)).status).toBe(413);
    const bad = new Request('https://koolmovez.com/api/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: HOST,
        'x-telegram-bot-api-secret-token': SECRET,
      },
      body: '{',
    });
    expect((await service.webhook(bad)).status).toBe(400);
  });
});

describe('telegram admin and delivery', () => {
  it('requires an authenticated website admin', async () => {
    const { service, calls } = harness();
    const wrongMethod = new Request('https://koolmovez.com/api/telegram-admin', { method: 'GET' });
    expect((await service.admin(wrongMethod)).status).toBe(405);
    const missing = new Request('https://koolmovez.com/api/telegram-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: HOST },
      body: JSON.stringify({ op: 'deliver', text: 'please send this' }),
    });
    expect((await service.admin(missing)).status).toBe(401);
    expect((await service.admin(admin({ op: 'list-tickets' }, CUSTOMER))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('shows disabled status to an admin and does not call Telegram', async () => {
    const { service, calls } = harness({ config: null, reasons: ['missing_bot_token'] });
    const response = await service.admin(admin({ op: 'confirm-rate', previewId: '11111111-1111-4111-8111-111111111111' }));
    const body = asJson(await response.json());
    expect(body.status).toBe('disabled');
    expect(body.reasons).toEqual(['missing_bot_token']);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(calls).toEqual([]);
  });

  it('isolates an outbox failure from the business record and dedupes alerts', async () => {
    const store = createMemoryTelegramStore();
    const broken = {
      ...store,
      async enqueueAlert() {
        throw new Error('db down');
      },
    };
    const isolated = await recordBusinessAlert(broken, {
      dedupeKey: 'exchange:KMX-123456',
      kind: 'exchange_request',
      recordKey: 'KMX-123456',
      now: 0,
      notBefore: null,
    });
    expect(isolated).toEqual({ recorded: false });

    const { service, records, calls } = harness();
    records.set('exchange_request:KMX-123456', {
      kind: 'exchange_request',
      recordKey: 'KMX-123456',
      status: 'pending',
      freightType: null,
    });
    Object.assign(records.get('exchange_request:KMX-123456') as object, {
      email: 'person@example.com',
      phone: '08031234567',
      receipt: 'https://files.example/proof',
    });
    const first = asJson(await (await service.admin(admin({ op: 'reconcile' }))).json());
    const second = asJson(await (await service.admin(admin({ op: 'reconcile' }))).json());
    expect(first).toMatchObject({ created: 1, existing: 0, delivered: false });
    expect(second).toMatchObject({ created: 0, existing: 1, delivered: false });
    expect(calls).toEqual([]);
    const delivered = asJson(await (await service.admin(admin({ op: 'deliver', text: '<b>hack the alert</b>' }))).json());
    expect(delivered.alerts).toHaveLength(1);
    expect(delivered.alerts[0]).toMatchObject({ status: 'sent', delivered: true, recordKey: 'KMX-123456' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('Ref: KMX-123456');
    expect(calls[0].text).toContain('Type: exchange');
    expect(calls[0].text).toContain('Status: pending');
    expect(calls[0].text).toContain('https://koolmovez.com/admin');
    expect(calls[0].text).not.toContain('person@example.com');
    expect(calls[0].text).not.toContain('08031234567');
    expect(calls[0].text).not.toContain('proof');
    expect(calls[0].text).not.toContain('hack');
    const again = asJson(await (await service.admin(admin({ op: 'deliver' }))).json());
    expect(again.alerts).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('retries a rate limit, does not retry an unconfirmed send, and skips chats already delivered', async () => {
    const seen = new Map<string, number>();
    const { service, records, calls, setNow, now } = harness({
      config: testConfig({ TELEGRAM_ADMIN_CHAT_IDS: '10001,10002' }),
      onSend: (call) => {
        const count = (seen.get(call.chatId) ?? 0) + 1;
        seen.set(call.chatId, count);
        if (call.chatId === '10002' && count === 1) {
          return { classification: 'retryable', messageId: null, code: 'telegram_http_429' };
        }
        return { classification: 'accepted', messageId: '7', code: null };
      },
    });
    records.set('exchange_request:KMX-654321', {
      kind: 'exchange_request',
      recordKey: 'KMX-654321',
      status: 'pending',
      freightType: null,
    });
    await service.admin(admin({ op: 'reconcile' }));
    const partial = asJson(await (await service.admin(admin({ op: 'deliver' }))).json());
    expect(partial.alerts[0]).toMatchObject({ status: 'queued', delivered: false, lastError: 'telegram_http_429' });
    const tooSoon = await service.worker(worker());
    expect((asJson(await tooSoon.json())).alerts).toEqual([]);
    setNow(now() + 31_000);
    const rest = asJson(await (await service.worker(worker())).json());
    expect(rest.alerts[0]).toMatchObject({ status: 'sent', delivered: true });
    expect(calls.filter((call) => call.chatId === '10001')).toHaveLength(1);
    expect(calls.filter((call) => call.chatId === '10002')).toHaveLength(2);

    const unknown = harness({
      onSend: () => ({ classification: 'unknown', messageId: null, code: 'telegram_http_500' }),
    });
    unknown.records.set('logistics_request:11111111-1111-4111-8111-111111111111', {
      kind: 'logistics_request',
      recordKey: '11111111-1111-4111-8111-111111111111',
      status: 'pending_packing',
      freightType: 'air',
    });
    await unknown.service.admin(admin({ op: 'reconcile' }));
    const review = asJson(await (await unknown.service.admin(admin({ op: 'deliver' }))).json());
    expect(review.alerts[0]).toMatchObject({ status: 'needs_review', delivered: false });
    const held = asJson(await (await unknown.service.worker(worker())).json());
    expect(held.alerts).toEqual([]);
    expect(unknown.calls).toHaveLength(1);
    const retried = asJson(await (await unknown.service.admin(admin({ op: 'retry-alerts' }))).json());
    expect(retried.alerts[0].status).toBe('needs_review');
    expect(unknown.calls).toHaveLength(2);
  });

  it('cancels an alert when the business row is gone and waits for a future attempt', async () => {
    const { service, store, calls, setNow, now } = harness();
    await store.enqueueAlert({
      dedupeKey: 'logistics:22222222-2222-4222-8222-222222222222',
      kind: 'logistics_request',
      recordKey: '22222222-2222-4222-8222-222222222222',
      now: now(),
      notBefore: now() + 120_000,
    });
    expect((asJson(await (await service.admin(admin({ op: 'deliver' }))).json())).alerts).toEqual([]);
    expect(calls).toEqual([]);
    setNow(now() + 120_000);
    const cancelled = asJson(await (await service.admin(admin({ op: 'deliver' }))).json());
    expect(cancelled.alerts[0]).toMatchObject({ status: 'cancelled', delivered: false, lastError: 'record_missing' });
    expect(calls).toEqual([]);
  });

  it('replies only on the ticket that owns the chat and reports the real delivery status', async () => {
    const { service, calls } = harness({
      onSend: (call) =>
        call.text === 'Thanks, a person will review this.'
          ? { classification: 'unknown', messageId: null, code: 'telegram_timeout' }
          : { classification: 'accepted', messageId: '3', code: null },
    });
    await service.webhook(webhook(callback(1, 555001, 'support')));
    const listed = asJson(await (await service.admin(admin({ op: 'list-tickets' }))).json());
    const ticketId = listed.tickets[0].id as string;
    const missing = await service.admin(admin({
      op: 'reply',
      ticketId: '33333333-3333-4333-8333-333333333333',
      body: 'nope',
      chatId: '999999',
    }));
    expect(missing.status).toBe(404);
    const sent = asJson(await (await service.admin(admin({
      op: 'reply',
      ticketId,
      body: 'Thanks, a person will review this.\u0000',
      chatId: '999999',
    }))).json());
    expect(sent.message).toMatchObject({ status: 'needs_review', delivered: false, lastError: 'telegram_timeout' });
    expect(calls.at(-1)).toMatchObject({ chatId: '555001', text: 'Thanks, a person will review this.' });
    expect(calls.some((call) => call.chatId === '999999')).toBe(false);
  });

  it('publishes a rate only after admin preview and confirm, once', async () => {
    const { service, calls, setRate } = harness();
    const loaded = await service.admin(admin({ op: 'status' }));
    expect(loaded.status).toBe(200);
    expect(calls).toEqual([]);
    const preview = asJson(await (await service.admin(admin({ op: 'preview-rate' }))).json());
    expect(preview.preview).toMatchObject({ status: 'preview', delivered: false });
    expect(preview.preview.body).toBe(broadcastBody('https://koolmovez.com', '1 RMB = ₦210'));
    expect(calls).toEqual([]);

    const confirmed = asJson(await (await service.admin(admin({ op: 'confirm-rate', previewId: preview.preview.id }))).json());
    expect(confirmed.broadcast).toMatchObject({ status: 'sent', delivered: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].chatId).toBe('-1001234567890');
    expect(calls[0].text).toBe(preview.preview.body);
    const repeat = asJson(await (await service.admin(admin({ op: 'confirm-rate', previewId: preview.preview.id }))).json());
    expect(repeat.broadcast.status).toBe('sent');
    expect(calls).toHaveLength(1);

    const same = asJson(await (await service.admin(admin({ op: 'preview-rate' }))).json());
    setRate({ raw: '211', parsed: { status: 'ready', rate: 211 } });
    const changed = await service.admin(admin({ op: 'confirm-rate', previewId: same.preview.id }));
    expect(changed.status).toBe(409);
    expect(asJson(await changed.json())).toMatchObject({ error: 'rate_changed' });
    expect(calls).toHaveLength(1);
  });

  it('does not broadcast when the rate is unavailable, the channel is missing, or delivery is unconfirmed', async () => {
    const unavailable = harness({ rate: null });
    const refused = await unavailable.service.admin(admin({ op: 'preview-rate' }));
    expect(refused.status).toBe(409);
    expect(unavailable.calls).toEqual([]);

    const noChannel = harness({ config: testConfig({ TELEGRAM_CHANNEL_ID: '' }) });
    const preview = asJson(await (await noChannel.service.admin(admin({ op: 'preview-rate' }))).json());
    const confirm = await noChannel.service.admin(admin({ op: 'confirm-rate', previewId: preview.preview.id }));
    expect(confirm.status).toBe(409);
    expect(noChannel.calls).toEqual([]);

    const uncertain = harness({
      onSend: () => ({ classification: 'unknown', messageId: null, code: 'telegram_timeout' }),
    });
    const shown = asJson(await (await uncertain.service.admin(admin({ op: 'preview-rate' }))).json());
    const posted = asJson(await (await uncertain.service.admin(admin({ op: 'confirm-rate', previewId: shown.preview.id }))).json());
    expect(posted.broadcast).toMatchObject({ status: 'needs_review', delivered: false });
    await uncertain.service.worker(worker());
    expect(uncertain.calls).toHaveLength(1);
    const blocked = asJson(await (await uncertain.service.admin(admin({ op: 'preview-rate' }))).json());
    const second = await uncertain.service.admin(admin({ op: 'confirm-rate', previewId: blocked.preview.id }));
    expect(second.status).toBe(409);
    expect(uncertain.calls).toHaveLength(1);
    const resolved = asJson(await (await uncertain.service.admin(admin({
      op: 'resolve-broadcast',
      id: posted.broadcast.id,
      resolution: 'not_posted',
    }))).json());
    expect(resolved.broadcast).toMatchObject({ status: 'cancelled', delivered: false });
    expect(uncertain.calls).toHaveLength(1);
  });

  it('rejects a worker without the secret and does not accept a customer message as the worker body', async () => {
    const { service, calls } = harness();
    expect((await service.worker(worker('nope-nope-nope-nope'))).status).toBe(401);
    const posted = await service.worker(new Request('https://koolmovez.com/api/telegram-worker', {
      method: 'POST',
      headers: { authorization: `Bearer ${WORKER}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: '<b>broadcast this</b>', chat_id: '-1001234567890' }),
    }));
    expect(posted.status).toBe(200);
    expect(calls).toEqual([]);
    const off = harness({ config: testConfig({ TELEGRAM_WORKER_SECRET: '' }) });
    expect((await off.service.worker(worker())).status).toBe(503);
  });
});

describe('automatic admin delivery', () => {
  it('notifies the admin when a support ticket is committed and still accepts the customer if that send times out', async () => {
    const { service, calls } = harness({
      onSend: (call) =>
        call.chatId === '10001'
          ? { classification: 'unknown', messageId: null, code: 'telegram_timeout' }
          : { classification: 'accepted', messageId: '1', code: null },
    });
    const opened = await service.webhook(webhook(callback(1, 555001, 'support')));
    expect(opened.status).toBe(200);
    expect(calls.some((call) => call.chatId === '555001' && call.text === SUPPORT_OPENED)).toBe(true);
    const alert = calls.find((call) => call.chatId === '10001');
    expect(alert?.text).toContain('Type: support');
    expect(alert?.text).not.toContain('555001');
    await service.webhook(webhook(privateMessage(2, 555001, 'private account 999')));
    expect(calls.filter((call) => call.chatId === '10001').every((call) => !call.text.includes('private account'))).toBe(true);
    const listed = asJson(await (await service.admin(admin({ op: 'list-alerts' }))).json());
    expect(listed.alerts[0]).toMatchObject({ kind: 'support_request', status: 'needs_review', delivered: false });
    const replay = await service.webhook(webhook(callback(1, 555001, 'support')));
    expect((asJson(await replay.json())).duplicate).toBe(true);
    expect(calls.filter((call) => call.chatId === '10001')).toHaveLength(1);
  });

  it('sends an exchange alert from the worker as soon as the committed outbox row exists, and a second call does not send it again', async () => {
    const { service, store, records, calls, now } = harness();
    records.set('exchange_request:KMX-111111', {
      kind: 'exchange_request',
      recordKey: 'KMX-111111',
      status: 'pending',
      freightType: null,
    });
    expect(await store.enqueueAlert({
      dedupeKey: 'exchange:KMX-111111',
      kind: 'exchange_request',
      recordKey: 'KMX-111111',
      now: now(),
      notBefore: null,
    })).toBe('created');
    expect(await store.enqueueAlert({
      dedupeKey: 'exchange:KMX-111111',
      kind: 'exchange_request',
      recordKey: 'KMX-111111',
      now: now(),
      notBefore: null,
    })).toBe('exists');
    const firstClaim = await store.claimAlert(now());
    const secondClaim = await store.claimAlert(now());
    expect(firstClaim?.status).toBe('sending');
    expect(secondClaim).toBeNull();
    await store.settleAlert(firstClaim!.id, {
      status: 'queued',
      lastError: null,
      nextAttemptAt: null,
      claimedAt: null,
      telegramMessageId: null,
      deliveredChatIds: [],
    });
    const sent = asJson(await (await service.worker(worker(WORKER))).json());
    expect(sent.alerts[0]).toMatchObject({ status: 'sent', delivered: true, recordKey: 'KMX-111111' });
    const again = asJson(await (await service.worker(new Request('https://koolmovez.com/api/telegram-worker', {
      method: 'POST',
      headers: { authorization: `Bearer ${WORKER}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'send this instead', chat_id: '10001' }),
    }))).json());
    expect(again.alerts).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('Type: exchange');
    expect(calls[0].text).not.toContain('send this instead');
  });

  it('does not wait to notify a logistics request, and a thrown alert cannot fail the customer ack', async () => {
    const { service, store, records, calls, now } = harness({
      onSend: (call) => {
        if (call.chatId === '10001') throw new Error('telegram down');
        return { classification: 'accepted', messageId: '1', code: null };
      },
    });
    records.set('logistics_request:44444444-4444-4444-8444-444444444444', {
      kind: 'logistics_request',
      recordKey: '44444444-4444-4444-8444-444444444444',
      status: 'pending_packing',
      freightType: 'sea',
    });
    await store.enqueueAlert({
      dedupeKey: 'logistics:44444444-4444-4444-8444-444444444444',
      kind: 'logistics_request',
      recordKey: '44444444-4444-4444-8444-444444444444',
      now: now(),
      notBefore: null,
    });
    const sent = asJson(await (await service.worker(worker())).json());
    expect(sent.alerts[0]).toMatchObject({ status: 'needs_review', delivered: false, lastError: 'telegram_network' });
    const opened = await service.webhook(webhook(callback(7, 555001, 'support')));
    expect(opened.status).toBe(200);
    expect(calls.some((call) => call.text === SUPPORT_OPENED)).toBe(true);
  });
});

describe('immediate channel rate on save', () => {
  const adminId = '11111111-1111-4111-8111-111111111111';

  it('posts every changed rate in the save request, including a later return to an earlier rate', async () => {
    const { service, store, calls, now, setRate } = harness();
    await store.recordRateChange({ rateValue: '215', previousValue: '210', createdBy: adminId, now: now() });
    const posted = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '210' }))).json());
    expect(posted.broadcasts[0]).toMatchObject({ status: 'sent', delivered: true, rateLine: '1 RMB = ₦215' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      chatId: '-1001234567890',
      text: broadcastBody('https://koolmovez.com', '1 RMB = ₦215'),
    });
    expect(calls[0].text).not.toMatch(/startapp|t\.me/i);
    expect(calls[0].text).not.toMatch(/packing|freight|clearing/i);
    setRate({ raw: '215', parsed: { status: 'ready', rate: 215 } });
    await service.admin(admin({ op: 'publish-saved-rate', previous: '210' }));
    expect(calls).toHaveLength(1);

    await store.recordRateChange({ rateValue: '216', previousValue: '215', createdBy: adminId, now: now() });
    await store.recordRateChange({ rateValue: '215', previousValue: '216', createdBy: adminId, now: now() });
    const more = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '215' }))).json());
    expect(more.broadcasts.map((row: { rateLine: string; status: string }) => [row.rateLine, row.status])).toEqual([
      ['1 RMB = ₦216', 'sent'],
      ['1 RMB = ₦215', 'sent'],
    ]);
    expect(calls.map((call) => call.text)).toEqual([
      broadcastBody('https://koolmovez.com', '1 RMB = ₦215'),
      broadcastBody('https://koolmovez.com', '1 RMB = ₦216'),
      broadcastBody('https://koolmovez.com', '1 RMB = ₦215'),
    ]);
  });

  it('does not start a second post while that change is already being sent', async () => {
    const { service, store, calls, now, setRate } = harness();
    setRate({ raw: '211', parsed: { status: 'ready', rate: 211 } });
    await store.recordRateChange({ rateValue: '211', previousValue: '210', createdBy: adminId, now: now() });
    expect(await store.claimRateChange(now())).toMatchObject({ installed: true, change: { status: 'sending' } });
    const response = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '210' }))).json());
    expect(response.inFlight).toBe(true);
    expect(response.broadcasts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('does not post when the saved number is unchanged', async () => {
    const { service, store, calls, now } = harness();
    await store.recordRateChange({ rateValue: '210', previousValue: '210', createdBy: adminId, now: now() });
    await store.recordRateChange({ rateValue: '210.00', previousValue: '210', createdBy: adminId, now: now() });
    const response = await service.admin(admin({ op: 'publish-saved-rate', previous: '210' }));
    expect(response.status).toBe(200);
    expect(asJson(await response.json()).broadcasts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('posts the live rate immediately when the change table is not installed yet', async () => {
    const { service, calls, setRate } = harness({ rateChangesInstalled: false });
    setRate({ raw: '211', parsed: { status: 'ready', rate: 211 } });
    const first = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '210' }))).json());
    expect(first.broadcasts[0]).toMatchObject({ status: 'sent', delivered: true, rateLine: '1 RMB = ₦211' });
    expect(calls[0].text).toBe(broadcastBody('https://koolmovez.com', '1 RMB = ₦211'));
    const same = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '211' }))).json());
    expect(same.broadcasts).toEqual([]);
    expect(calls).toHaveLength(1);
    setRate({ raw: '210', parsed: { status: 'ready', rate: 210 } });
    const back = asJson(await (await service.admin(admin({ op: 'publish-saved-rate', previous: '211' }))).json());
    expect(back.broadcasts[0].rateLine).toBe('1 RMB = ₦210');
    expect(calls).toHaveLength(2);
  });

  it('leaves an unconfirmed send on needs_review and still posts the next different rate immediately', async () => {
    const { service, store, calls, now } = harness({
      onSend: () => ({ classification: 'unknown', messageId: null, code: 'telegram_timeout' }),
    });
    await store.recordRateChange({ rateValue: '211', previousValue: '210', createdBy: adminId, now: now() });
    const failed = asJson(await (await service.worker(worker())).json());
    expect(failed.broadcasts[0]).toMatchObject({ status: 'needs_review', delivered: false, lastError: 'telegram_timeout' });
    expect(calls).toHaveLength(1);
    await service.worker(worker());
    expect(calls).toHaveLength(1);
    await store.recordRateChange({ rateValue: '212', previousValue: '211', createdBy: adminId, now: now() });
    const next = asJson(await (await service.worker(worker())).json());
    expect(next.broadcasts[0]).toMatchObject({ status: 'needs_review', delivered: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toBe(broadcastBody('https://koolmovez.com', '1 RMB = ₦212'));
  });

  it('refuses a channel post without a channel and still lets an admin publish a preview once', async () => {
    const missing = harness({ config: testConfig({ TELEGRAM_CHANNEL_ID: '' }) });
    await missing.store.recordRateChange({
      rateValue: '211',
      previousValue: '210',
      createdBy: adminId,
      now: missing.now(),
    });
    const refused = await missing.service.admin(admin({ op: 'publish-saved-rate', previous: '210' }));
    expect(refused.status).toBe(409);
    expect(asJson(await refused.json())).toEqual({ error: 'missing_channel' });
    await missing.service.worker(worker());
    expect(missing.calls).toEqual([]);

    const { service, calls } = harness();
    const preview = asJson(await (await service.admin(admin({ op: 'preview-rate' }))).json());
    expect(preview.preview.status).toBe('preview');
    expect(calls).toEqual([]);
    const confirmed = asJson(await (await service.admin(admin({ op: 'confirm-rate', previewId: preview.preview.id }))).json());
    expect(confirmed.broadcast).toMatchObject({ status: 'sent', delivered: true });
    expect(calls).toHaveLength(1);
    await service.admin(admin({ op: 'confirm-rate', previewId: preview.preview.id }));
    expect(calls).toHaveLength(1);
  });
});

describe('approved copy and source boundaries', () => {
  it('does not put the bot token or Telegram API in the browser client', () => {
    const client = readFileSync(new URL('../../src/lib/telegramAdminClient.ts', import.meta.url), 'utf8');
    const dashboard = readFileSync(new URL('../../src/components/UserDashboard.tsx', import.meta.url), 'utf8');
    const rate = readFileSync(new URL('../../src/lib/publishedExchangeRateSource.ts', import.meta.url), 'utf8');
    expect(client).not.toContain('TELEGRAM_BOT');
    expect(client).not.toContain('api.telegram.org');
    expect(client).not.toContain('VITE_');
    expect(dashboard).not.toContain('telegram');
    expect(rate).not.toContain('telegram');
  });
});

function markupIsAllowlisted(markup: unknown): boolean {
  if (typeof markup !== 'object' || markup === null) return false;
  const rows = Reflect.get(markup, 'inline_keyboard');
  if (!Array.isArray(rows)) return false;
  const allowed = new Set(['exchange', 'logistics', 'track', 'support']);
  return rows.every((row) =>
    Array.isArray(row) &&
    row.every((button) => typeof button?.callback_data === 'string' && allowed.has(button.callback_data)),
  );
}
