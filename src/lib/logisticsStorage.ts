/**
 * KoolMovez Logistics — 14-day free storage at Nigeria pickup.
 *
 * Arrival date uses existing shipments.estimated_arrival (date).
 * Storage charge is computed for display only; it is not written to
 * shipments.total_amount_due or other cost snapshot columns.
 */

export const FREE_STORAGE_DAYS = 14;

export type LogisticsStorageBreakdown = {
  arrivalDate: string | null;
  asOfDate: string;
  accumulating: boolean;
  freeStorageDays: number;
  daysElapsed: number;
  chargeableDays: number;
  storageFeePerDay: number;
  storageCharge: number;
};

export function airShipmentShowsStorage(status: string): boolean {
  return (
    status === 'arrived_nigeria' ||
    status === 'ready_for_pickup' ||
    status === 'completed'
  );
}

export function parseCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function utcTodayCalendarDate(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function utcMillis(dateOnly: string): number | null {
  const parsed = parseCalendarDate(dateOnly);
  if (!parsed) return null;
  const [year, month, day] = parsed.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

/** Whole calendar days from fromDate to toDate (0 on the same UTC date). */
export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const fromMs = utcMillis(fromDate);
  const toMs = utcMillis(toDate);
  if (fromMs == null || toMs == null) return 0;
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * calendar_days_since_arrival = inclusive UTC calendar days from arrival through as-of
 * (arrival day is day 1).
 * chargeable_days = max(0, calendar_days_since_arrival - 14)
 * storage_charge = chargeable_days × storage_fee_per_day
 *
 * Days 1–14 are free. Charges begin on day 15.
 * Completed shipments freeze as-of the completed row's updated_at date.
 */
export function computeLogisticsStorage(input: {
  estimatedArrival: string | null | undefined;
  status: string;
  updatedAt?: string | null;
  storageFeePerDay: number | null | undefined;
  now?: Date;
}): LogisticsStorageBreakdown | null {
  if (!airShipmentShowsStorage(input.status)) return null;

  const arrivalDate = parseCalendarDate(input.estimatedArrival);
  const accumulating = input.status !== 'completed';
  const asOfDate = accumulating
    ? utcTodayCalendarDate(input.now)
    : parseCalendarDate(input.updatedAt) || utcTodayCalendarDate(input.now);

  const rawFee = Number(input.storageFeePerDay);
  const storageFeePerDay = Number.isFinite(rawFee) && rawFee > 0 ? rawFee : 0;

  if (!arrivalDate) {
    return {
      arrivalDate: null,
      asOfDate,
      accumulating,
      freeStorageDays: FREE_STORAGE_DAYS,
      daysElapsed: 0,
      chargeableDays: 0,
      storageFeePerDay,
      storageCharge: 0,
    };
  }

  const dateDiff = calendarDaysBetween(arrivalDate, asOfDate);
  const calendarDaysSinceArrival = dateDiff < 0 ? 0 : dateDiff + 1;
  const chargeableDays = Math.max(0, calendarDaysSinceArrival - FREE_STORAGE_DAYS);
  const storageCharge = roundMoney(chargeableDays * storageFeePerDay);

  return {
    arrivalDate,
    asOfDate,
    accumulating,
    freeStorageDays: FREE_STORAGE_DAYS,
    daysElapsed: calendarDaysSinceArrival,
    chargeableDays,
    storageFeePerDay,
    storageCharge,
  };
}
