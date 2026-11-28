import { supabase } from './supabaseClient';
import { logisticsPaymentStatusLabel, normalizeLogisticsPayment } from '../types/logisticsPayment';
import {
  airShipmentStatusLabel,
  normalizeLogisticsShipment,
  seaShipmentStatusLabel,
} from '../types/shipment';

export const EXCHANGE_NOTIFICATION_COLUMNS =
  'id, reference_number, rmb_amount, status, admin_note, created_at';
export const PACKING_NOTIFICATION_COLUMNS = 'id, freight_type, status, created_at';
export const SHIPMENT_NOTIFICATION_COLUMNS =
  'id, shipment_code, freight_type, status, created_at, updated_at';
export const LOGISTICS_PAYMENT_NOTIFICATION_COLUMNS =
  'id, status, amount_due, rejection_note, created_at, updated_at, submitted_at';

export type RecentNotification = {
  id: string;
  source: 'Exchange' | 'Air Freight' | 'Sea Freight' | 'Logistics' | 'Platform';
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  time: string;
  at: number;
};

type QueryResult = { data: unknown; error: unknown };

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'Recently';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently';

  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function stamp(iso: string | null | undefined) {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function exchangeToNotification(req: Record<string, unknown>, now = Date.now()): RecentNotification | null {
  if (req.id == null) return null;
  const status = text(req.status || 'pending').toLowerCase();
  const amount = req.rmb_amount != null && req.rmb_amount !== '' ? `${req.rmb_amount} RMB` : 'your exchange';
  const reference = text(req.reference_number);
  const label = reference ? `Exchange ${reference}` : 'Exchange request';
  const atIso = text(req.created_at) || null;

  if (status === 'completed' || status === 'approved') {
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'success',
      title: 'Exchange completed',
      message: `${label} for ${amount} was completed.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  if (status === 'rejected') {
    const note = text(req.admin_note).trim();
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'error',
      title: 'Exchange rejected',
      message: note
        ? `${label} for ${amount} was rejected: ${note}`
        : `${label} for ${amount} was rejected.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  if (status === 'processing') {
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'info',
      title: 'Exchange update',
      message: `${label} for ${amount} is now processing.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  return {
    id: `ex-${req.id}`,
    source: 'Exchange',
    type: 'info',
    title: 'Exchange submitted',
    message: `${label} for ${amount} was submitted and is pending review.`,
    time: formatRelativeTime(atIso, now),
    at: stamp(atIso),
  };
}

export function packingToNotification(row: Record<string, unknown>, now = Date.now()): RecentNotification | null {
  if (row.id == null) return null;
  const freight = text(row.freight_type) === 'sea' ? 'Sea Freight' : 'Air Freight';
  const status = text(row.status || 'pending_packing');
  const readable = status.replace(/_/g, ' ');
  const atIso = text(row.created_at) || null;
  const submitted = status === 'pending_packing' || status === 'pending';
  return {
    id: `pk-${row.id}`,
    source: freight,
    type: 'info',
    title: submitted ? 'Packing request submitted' : `${freight} packing`,
    message: submitted
      ? `${freight} packing request was submitted and is ${readable}.`
      : `${freight} packing request is ${readable}.`,
    time: formatRelativeTime(atIso, now),
    at: stamp(atIso),
  };
}

export function shipmentToNotification(row: Record<string, unknown>, now = Date.now()): RecentNotification | null {
  if (row.id == null || !text(row.shipment_code)) return null;
  const shipment = normalizeLogisticsShipment(row);
  const freight = shipment.freight_type === 'sea' ? 'Sea Freight' : 'Air Freight';
  const label = freight === 'Sea Freight' ? seaShipmentStatusLabel(shipment.status) : airShipmentStatusLabel(shipment.status);
  const atIso = shipment.updated_at || shipment.created_at;
  const isDone = shipment.status === 'completed';
  const isProblem = shipment.status === 'cancelled';
  return {
    id: `sh-${shipment.id}`,
    source: freight,
    type: isDone ? 'success' : isProblem ? 'error' : 'info',
    title: `${freight} update`,
    message: `${shipment.shipment_code}: ${label}.`,
    time: formatRelativeTime(atIso, now),
    at: stamp(atIso),
  };
}

export function logisticsPaymentToNotification(row: Record<string, unknown>, now = Date.now()): RecentNotification | null {
  if (row.id == null) return null;
  const payment = normalizeLogisticsPayment(row);
  const atIso = payment.updated_at || payment.submitted_at || payment.created_at;
  const amount =
    payment.amount_due != null && Number.isFinite(payment.amount_due)
      ? ` of ₦${payment.amount_due.toLocaleString()}`
      : '';
  const note = payment.rejection_note?.trim();

  if (payment.status === 'submitted') {
    return {
      id: `lp-${payment.id}`,
      source: 'Logistics',
      type: 'info',
      title: 'Logistics payment submitted',
      message: `Logistics payment${amount} was submitted and is awaiting confirmation.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  if (payment.status === 'confirmed') {
    return {
      id: `lp-${payment.id}`,
      source: 'Logistics',
      type: 'success',
      title: 'Logistics payment confirmed',
      message: `Logistics payment${amount} was confirmed.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  if (payment.status === 'rejected') {
    return {
      id: `lp-${payment.id}`,
      source: 'Logistics',
      type: 'error',
      title: 'Logistics payment rejected',
      message: note
        ? `Logistics payment${amount} was rejected: ${note}`
        : `Logistics payment${amount} was rejected.`,
      time: formatRelativeTime(atIso, now),
      at: stamp(atIso),
    };
  }

  return {
    id: `lp-${payment.id}`,
    source: 'Logistics',
    type: 'info',
    title: 'Logistics payment',
    message: `Logistics payment${amount}: ${logisticsPaymentStatusLabel(payment.status)}.`,
    time: formatRelativeTime(atIso, now),
    at: stamp(atIso),
  };
}

function settingsNotifications(rows: Record<string, unknown>[]): RecentNotification[] {
  const map: Record<string, string> = {};
  rows.forEach((row) => {
    map[text(row.key)] = text(row.value);
  });
  const collected: RecentNotification[] = [];

  const airNotice = map.air_freight_notice?.trim();
  if (airNotice) {
    collected.push({
      id: 'sys-air-notice',
      source: 'Air Freight',
      type: 'info',
      title: 'Air Freight update',
      message: airNotice,
      time: 'Published',
      at: 1,
    });
  }

  const seaNotice = map.sea_freight_notice?.trim();
  if (seaNotice) {
    collected.push({
      id: 'sys-sea-notice',
      source: 'Sea Freight',
      type: 'info',
      title: 'Sea Freight update',
      message: seaNotice,
      time: 'Published',
      at: 1,
    });
  }

  const platformStatus = (map.platform_status || 'active').toLowerCase();
  const offlineMsg = map.offline_msg?.trim();
  if (platformStatus && platformStatus !== 'active' && offlineMsg) {
    collected.push({
      id: 'sys-platform',
      source: 'Platform',
      type: 'error',
      title: 'Platform update',
      message: offlineMsg,
      time: 'Published',
      at: 1,
    });
  }

  return collected;
}

function asRows(value: unknown[] | null | undefined): Record<string, unknown>[] {
  if (!value) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

export function buildCustomerNotifications(
  input: {
    exchanges?: unknown[] | null;
    packing?: unknown[] | null;
    shipments?: unknown[] | null;
    logisticsPayments?: unknown[] | null;
    settings?: unknown[] | null;
  },
  now = Date.now(),
): RecentNotification[] {
  const collected: RecentNotification[] = [];
  asRows(input.exchanges).forEach((row) => {
    const item = exchangeToNotification(row, now);
    if (item) collected.push(item);
  });
  asRows(input.packing).forEach((row) => {
    const item = packingToNotification(row, now);
    if (item) collected.push(item);
  });
  asRows(input.shipments).forEach((row) => {
    const item = shipmentToNotification(row, now);
    if (item) collected.push(item);
  });
  asRows(input.logisticsPayments).forEach((row) => {
    const item = logisticsPaymentToNotification(row, now);
    if (item) collected.push(item);
  });
  collected.push(...settingsNotifications(asRows(input.settings)));
  collected.sort((a, b) => b.at - a.at);
  return collected.slice(0, 8);
}

async function readRows(query: PromiseLike<QueryResult>): Promise<unknown[] | null> {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return null;
  return data;
}

export async function loadCustomerNotifications(
  scope: { userId: string | null; kmId: string | null },
  now = Date.now(),
): Promise<RecentNotification[]> {
  const exchanges = scope.userId
    ? await readRows(
        supabase
          .from('exchange_requests')
          .select(EXCHANGE_NOTIFICATION_COLUMNS)
          .eq('user_id', scope.userId)
          .order('created_at', { ascending: false })
          .limit(8),
      )
    : null;

  const packing = scope.userId
    ? await readRows(
        supabase
          .from('packing_requests')
          .select(PACKING_NOTIFICATION_COLUMNS)
          .eq('user_id', scope.userId)
          .order('created_at', { ascending: false })
          .limit(8),
      )
    : null;

  const shipments = scope.kmId
    ? await readRows(
        supabase
          .from('shipments')
          .select(SHIPMENT_NOTIFICATION_COLUMNS)
          .eq('km_id', scope.kmId)
          .order('updated_at', { ascending: false })
          .limit(8),
      )
    : null;

  const logisticsPayments = scope.userId
    ? await readRows(
        supabase
          .from('logistics_payments')
          .select(LOGISTICS_PAYMENT_NOTIFICATION_COLUMNS)
          .eq('user_id', scope.userId)
          .order('updated_at', { ascending: false })
          .limit(8),
      )
    : null;

  const settings = await readRows(
    supabase
      .from('site_settings')
      .select('key, value')
      .in('key', ['air_freight_notice', 'sea_freight_notice', 'platform_status', 'offline_msg']),
  );

  return buildCustomerNotifications(
    { exchanges, packing, shipments, logisticsPayments, settings },
    now,
  );
}
