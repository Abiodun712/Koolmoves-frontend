import {
  formatPlatformRateLine,
  parsePublishedExchangeRate,
  type PublishedRate,
} from '../../src/lib/publishedExchangeRate';
import { safeToken } from './text';
import type { AlertKind } from './store';

export const EXCHANGE_ALERT_COLUMNS = 'reference_number, status';
export const LOGISTICS_ALERT_COLUMNS = 'id, status, freight_type';
export const RATE_COLUMNS = 'value';

export type BusinessRecord = {
  kind: AlertKind;
  recordKey: string;
  status: string;
  freightType: 'air' | 'sea' | null;
};

export type PublishedRateRead = {
  raw: string;
  parsed: PublishedRate;
};

const EXCHANGE_KEY = /^[A-Za-z0-9-]{4,40}$/;
const LOGISTICS_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalRateRaw(value: unknown): string | null {
  const parsed = parsePublishedExchangeRate(value);
  if (parsed.status !== 'ready') return null;
  if (typeof value === 'string') return value.trim();
  return String(parsed.rate);
}

export function readRateValue(value: unknown): PublishedRateRead | null {
  const raw = canonicalRateRaw(value);
  if (!raw) return null;
  const parsed = parsePublishedExchangeRate(value);
  if (parsed.status !== 'ready' || !formatPlatformRateLine(parsed.rate)) return null;
  return { raw, parsed };
}

export function parseExchangeRow(row: { reference_number?: unknown; status?: unknown } | null): BusinessRecord | null {
  if (!row || typeof row.reference_number !== 'string' || !EXCHANGE_KEY.test(row.reference_number)) return null;
  return {
    kind: 'exchange_request',
    recordKey: row.reference_number,
    status: safeToken(typeof row.status === 'string' ? row.status : '', 'unknown'),
    freightType: null,
  };
}

export function parseLogisticsRow(row: { id?: unknown; status?: unknown; freight_type?: unknown } | null): BusinessRecord | null {
  if (!row || typeof row.id !== 'string' || !LOGISTICS_KEY.test(row.id)) return null;
  const freight = row.freight_type === 'air' || row.freight_type === 'sea' ? row.freight_type : null;
  return {
    kind: 'logistics_request',
    recordKey: row.id.toLowerCase(),
    status: safeToken(typeof row.status === 'string' ? row.status : '', 'unknown'),
    freightType: freight,
  };
}
