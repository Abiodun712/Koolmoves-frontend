/** Digits with at most 12 integer digits and 2 decimal places. Empty and a trailing dot are in-progress drafts. */
const AMOUNT_DRAFT = /^(?:\d{0,12})(?:\.\d{0,2})?$/;

export type ParsedAmount =
  | { state: 'empty' }
  | { state: 'incomplete' }
  | { state: 'invalid' }
  | { state: 'ok'; value: number };

export function isAmountDraft(value: string): boolean {
  return AMOUNT_DRAFT.test(value);
}

/** Keep the previous draft when the next text is not a permitted amount. */
export function nextAmountDraft(current: string, incoming: string): string {
  return isAmountDraft(incoming) ? incoming : current;
}

export function parseAmountDraft(raw: string): ParsedAmount {
  if (!isAmountDraft(raw)) return { state: 'invalid' };
  if (raw === '') return { state: 'empty' };
  if (raw === '.') return { state: 'incomplete' };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return { state: 'invalid' };
  return { state: 'ok', value };
}

/** Half-up to kobo/fen. Non-finite and negative amounts do not produce a number. */
export function roundMoney(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const text = value.toFixed(8);
  if (text.startsWith('-')) return null;
  const [wholeText, fracText = ''] = text.split('.');
  const digits = (fracText + '000').slice(0, 3);
  let whole = Number(wholeText);
  let cents = Number(digits.slice(0, 2));
  const pivot = Number(digits[2] ?? '0');
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return null;
  if (pivot >= 5) cents += 1;
  if (cents === 100) {
    whole += 1;
    cents = 0;
  }
  if (whole > 999_999_999_999) return null;
  return whole + cents / 100;
}

export function formatDerivedAmount(value: number): string {
  const rounded = roundMoney(value);
  if (rounded == null) return '';
  return rounded.toFixed(2);
}

export function convertWithPublishedRate(
  amount: number,
  rate: number,
  direction: 'ngn-to-rmb' | 'rmb-to-ngn',
): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const raw = direction === 'rmb-to-ngn' ? amount * rate : amount / rate;
  return roundMoney(raw);
}

export function convertDraft(
  draft: string,
  rate: number,
  direction: 'ngn-to-rmb' | 'rmb-to-ngn',
): string {
  const parsed = parseAmountDraft(draft);
  if (parsed.state !== 'ok') return '';
  const converted = convertWithPublishedRate(parsed.value, rate, direction);
  if (converted == null) return '';
  return formatDerivedAmount(converted);
}

/** Pull a plain draft out of pasted text such as "₦1,250.50" or "RMB 10". */
export function sanitizePastedAmount(text: string): string | null {
  const cleaned = text.trim().replace(/rmb/gi, '').replace(/[₦¥,\s]/g, '');
  if (!cleaned || !isAmountDraft(cleaned)) return null;
  return cleaned;
}
