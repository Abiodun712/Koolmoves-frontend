/** Row the admin exchange screen saves and the signed-in exchange screen reads. */
export const PUBLISHED_EXCHANGE_RATE_KEY = 'exchange_rate';

/**
 * Existing Create Account route. Signup already links to Login (`/login`).
 * Exchange requests stay on `/dashboard`, behind the existing auth guard.
 */
export const START_EXCHANGE_PATH = '/signup';

export const INDICATIVE_RATE_NOTE =
  'Indicative rate based on the current published rate. Final rate is locked when you create an exchange request inside your account.';

export const LOADING_RATE_LABEL = 'Loading published rate...';
export const UNAVAILABLE_RATE_LABEL = 'Published rate unavailable';

export type PublishedRate =
  | { status: 'ready'; rate: number }
  | { status: 'unavailable' };

export type PublishedRateRead = {
  data: { value: unknown } | null;
  error: { message?: string } | null;
};

const PLAIN_RATE = /^\d+(\.\d{1,8})?$/;
const GROUPED_RATE = /^\d{1,3}(,\d{3})+(\.\d{1,8})?$/;

export function parsePublishedExchangeRate(value: unknown): PublishedRate {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return { status: 'unavailable' };
    return { status: 'ready', rate: value };
  }
  if (typeof value !== 'string') return { status: 'unavailable' };
  const trimmed = value.trim();
  const numeric = PLAIN_RATE.test(trimmed)
    ? trimmed
    : GROUPED_RATE.test(trimmed)
      ? trimmed.replace(/,/g, '')
      : null;
  if (numeric == null) return { status: 'unavailable' };
  const rate = Number(numeric);
  if (!Number.isFinite(rate) || rate <= 0) return { status: 'unavailable' };
  return { status: 'ready', rate };
}

export function formatPlatformRateLine(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const rendered = rate.toLocaleString('en-US', {
    maximumFractionDigits: 8,
    useGrouping: true,
  });
  return `1 RMB = ₦${rendered}`;
}

export function publishedRateFromRead(read: PublishedRateRead): PublishedRate {
  if (read.error || !read.data) return { status: 'unavailable' };
  return parsePublishedExchangeRate(read.data.value);
}

/** Read-only. A thrown query, an error, or a non-positive value is unavailable — never a stand-in rate. */
export async function fetchPublishedExchangeRate(
  query: () => Promise<PublishedRateRead>,
): Promise<PublishedRate> {
  try {
    return publishedRateFromRead(await query());
  } catch {
    return { status: 'unavailable' };
  }
}
