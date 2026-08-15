import { parseRatePerKgFromFeeText } from './logisticsCosting';

/** Logistics keys in public.site_settings. Do not include Exchange keys. */
export const LOGISTICS_FEE_KEYS = [
  'air_freight_fee',
  'sea_freight_fee',
  'packing_fee',
  'clearing_fee',
  'storage_fee_per_day',
] as const;

export function formatAirFreightFeeSetting(amount: number): string {
  return `₦${amount.toLocaleString()} / kg`;
}

export function parseNonNegativeFeeInput(
  raw: string,
  label: string
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/,/g, '');
  if (trimmed === '') {
    return { ok: false, error: `${label} is required.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a valid number.` };
  }
  if (value < 0) {
    return { ok: false, error: `${label} cannot be negative.` };
  }
  return { ok: true, value };
}

/** Load a stored numeric fee into an admin input. */
export function storedFeeToInput(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const n = Number(trimmed.replace(/,/g, ''));
  if (Number.isFinite(n) && n >= 0) return String(n);
  return '';
}

/** Load published air_freight_fee text (e.g. "₦8,500 / kg") into a numeric input. */
export function storedAirFreightFeeToInput(raw: string | null | undefined): string {
  const parsed = parseRatePerKgFromFeeText(raw);
  if (parsed != null && parsed >= 0) return String(parsed);
  return storedFeeToInput(raw);
}
