// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TelegramCallResult, TelegramClient } from './client';
import { loadTelegramConfig } from './config';
import { createTelegramService } from './service';
import { createSupabaseTelegramStore } from './supabase';
import type { BusinessRecord } from './business';

const WORKER = 'test-worker-secret-value';
const SUPPORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOGISTICS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXCHANGE_KEY = 'KMX-222222';

type Row = Record<string, unknown>;

function alertRow(input: {
  id: string;
  dedupeKey: string;
  kind: string;
  recordKey: string;
  createdAt: string;
}): Row {
  return {
    id: input.id,
    dedupe_key: input.dedupeKey,
    kind: input.kind,
    record_key: input.recordKey,
    status: 'queued',
    attempts: 0,
    next_attempt_at: null,
    claimed_at: null,
    delivered_chat_ids: [],
    telegram_message_id: null,
    last_error: null,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  };
}

function supportTicket(): Row {
  return {
    id: SUPPORT_ID,
    chat_id: '555001',
    telegram_user_id: '555001',
    status: 'open',
    created_from_update_id: 1,
    created_at: '2026-11-26T10:00:00.000Z',
    updated_at: '2026-11-26T10:00:00.000Z',
  };
}

function queuedBatch(): Row[] {
  return [
    alertRow({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      dedupeKey: `support:${SUPPORT_ID}`,
      kind: 'support_request',
      recordKey: SUPPORT_ID,
      createdAt: '2026-11-26T10:00:00.000Z',
    }),
    alertRow({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      dedupeKey: `exchange:${EXCHANGE_KEY}`,
      kind: 'exchange_request',
      recordKey: EXCHANGE_KEY,
      createdAt: '2026-11-26T10:05:00.000Z',
    }),
    alertRow({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      dedupeKey: `logistics:${LOGISTICS_ID}`,
      kind: 'logistics_request',
      recordKey: LOGISTICS_ID,
      createdAt: '2026-11-26T10:10:00.000Z',
    }),
  ];
}

describe('supabase alert outbox', () => {
  it('claims a queued support_request by key without disturbing a later exchange row', async () => {
    const alerts = queuedBatch().slice(0, 2);
    const store = createSupabaseTelegramStore(fakeAdmin({ telegram_alert_outbox: alerts }));
    const now = Date.parse('2026-11-26T11:00:00.000Z');

    const claimed = await store.claimAlertByKey(`support:${SUPPORT_ID}`, now);
    expect(claimed).toMatchObject({
      kind: 'support_request',
      recordKey: SUPPORT_ID,
      status: 'sending',
      attempts: 1,
      lastError: null,
    });

    const listed = await store.listAlerts();
    expect(listed.map((alert) => alert.kind)).toEqual(['exchange_request', 'support_request']);
    expect(alerts.find((row) => row.kind === 'exchange_request')).toMatchObject({ status: 'queued', last_error: null });

    const next = await store.claimAlert(now);
    expect(next).toMatchObject({ kind: 'exchange_request', status: 'sending', recordKey: EXCHANGE_KEY });
  });

  it('delivers a queued support_request from the worker without a 503, then the later exchange and logistics rows', async () => {
    const alerts = queuedBatch();
    const calls: string[] = [];
    const { service } = workerHarness(alerts, calls);

    const response = await service.worker(workerRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      alerts: Array<{ kind: string; status: string; delivered: boolean; lastError: string | null }>;
    };
    expect(body.alerts).toEqual([
      expect.objectContaining({
        kind: 'support_request',
        status: 'sent',
        delivered: true,
        recordKey: SUPPORT_ID,
        attempts: 1,
        lastError: null,
      }),
      expect.objectContaining({
        kind: 'exchange_request',
        status: 'sent',
        delivered: true,
        recordKey: EXCHANGE_KEY,
        attempts: 1,
        lastError: null,
      }),
      expect.objectContaining({
        kind: 'logistics_request',
        status: 'sent',
        delivered: true,
        recordKey: LOGISTICS_ID,
        attempts: 1,
        lastError: null,
      }),
    ]);
    expect(calls).toEqual([
      expect.stringContaining('Type: support'),
      expect.stringContaining('Type: exchange'),
      expect.stringContaining('Type: logistics'),
    ]);
    expect(alerts.map((row) => row.status)).toEqual(['sent', 'sent', 'sent']);
    expect(alerts.every((row) => row.last_error == null)).toBe(true);

    const again = await service.worker(workerRequest());
    expect(again.status).toBe(200);
    expect(((await again.json()) as { alerts: unknown[] }).alerts).toEqual([]);
    expect(calls).toHaveLength(3);
  });
});

function workerHarness(alerts: Row[], calls: string[]) {
  const loaded = loadTelegramConfig({
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456789:AAHexampleTokenValueForTestsOnly',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
    TELEGRAM_SITE_URL: 'https://koolmovez.com',
    TELEGRAM_ADMIN_CHAT_IDS: '10001',
    TELEGRAM_CHANNEL_ID: '',
    TELEGRAM_WORKER_SECRET: WORKER,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-which-is-not-the-anon-key',
  });
  if (!loaded.ok) throw new Error(loaded.reasons.join(','));
  const telegram: TelegramClient = {
    async sendMessage(chatId, text): Promise<TelegramCallResult> {
      if (chatId !== '10001') throw new Error('unexpected admin chat');
      calls.push(text);
      return { classification: 'accepted', messageId: String(calls.length), code: null };
    },
    async answerCallback() {
      return { classification: 'accepted', messageId: null, code: null };
    },
  };
  const service = createTelegramService({
    config: loaded.config,
    disabledReasons: [],
    store: createSupabaseTelegramStore(
      fakeAdmin({
        telegram_alert_outbox: alerts,
        telegram_support_tickets: [supportTicket()],
      }),
    ),
    telegram,
    authorizeAdmin: async () => ({ ok: false, status: 401 }),
    now: () => Date.parse('2026-11-26T11:00:00.000Z'),
    loadBusinessRecord: async (kind, recordKey) => businessRecord(kind, recordKey),
    listRecentBusiness: async () => [],
    readPublishedRate: async () => null,
  });
  return { service };
}

function businessRecord(kind: BusinessRecord['kind'], recordKey: string): BusinessRecord | null {
  if (kind === 'exchange_request' && recordKey === EXCHANGE_KEY) {
    return { kind, recordKey, status: 'pending', freightType: null };
  }
  if (kind === 'logistics_request' && recordKey === LOGISTICS_ID) {
    return { kind, recordKey, status: 'pending_packing', freightType: 'sea' };
  }
  return null;
}

function workerRequest() {
  return new Request('https://www.koolmovez.com/api/telegram-worker', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${WORKER}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ source: 'telegram_outbox' }),
  });
}

type Filter = { op: 'eq'; column: string; value: unknown } | { op: 'lt'; column: string; value: unknown };

function fakeAdmin(seed: Record<string, Row[]>): SupabaseClient {
  const tables = new Map<string, Row[]>(Object.entries(seed));
  return {
    from(name: string) {
      let rows = tables.get(name);
      if (!rows) {
        rows = [];
        tables.set(name, rows);
      }
      return query(rows);
    },
  } as unknown as SupabaseClient;
}

function query(rows: Row[]) {
  const filters: Filter[] = [];
  let ordering: { column: string; ascending: boolean } | null = null;
  let max: number | null = null;
  let patch: Row | null = null;
  let single = false;

  const builder = {
    select() {
      return builder;
    },
    update(next: Row) {
      patch = { ...next };
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: 'eq', column, value });
      return builder;
    },
    lt(column: string, value: unknown) {
      filters.push({ op: 'lt', column, value });
      return builder;
    },
    order(column: string, options: { ascending?: boolean }) {
      ordering = { column, ascending: options.ascending !== false };
      return builder;
    },
    limit(count: number) {
      max = count;
      return builder;
    },
    maybeSingle() {
      single = true;
      return builder;
    },
    then(
      onFulfilled: (value: { data: unknown; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(run()).then(onFulfilled, onRejected);
    },
  };

  function run() {
    let matched = rows.filter((row) => filters.every((filter) => matches(row, filter)));
    if (patch) {
      for (const row of matched) Object.assign(row, patch);
    }
    if (ordering) {
      const column = ordering.column;
      const direction = ordering.ascending ? 1 : -1;
      matched = [...matched].sort((left, right) => {
        const a = String(left[column] ?? '');
        const b = String(right[column] ?? '');
        if (a === b) return 0;
        const result = a < b ? -1 : 1;
        return result * direction;
      });
    }
    if (max != null) matched = matched.slice(0, max);
    if (single) return { data: matched[0] ? { ...matched[0] } : null, error: null };
    return { data: matched.map((row) => ({ ...row })), error: null };
  }

  return builder;
}

function matches(row: Row, filter: Filter): boolean {
  const value = row[filter.column];
  if (filter.op === 'eq') return value === filter.value;
  if (value == null || filter.value == null) return false;
  return String(value) < String(filter.value);
}
