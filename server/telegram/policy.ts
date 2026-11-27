export const MAX_DELIVERY_ATTEMPTS = 5;
export const LEASE_MS = 120_000;
export const PREVIEW_TTL_MS = 15 * 60_000;
/** Database waits at most this long for the worker. Each Telegram call aborts sooner. */
export const DISPATCH_WAIT_MS = 10_000;
export const AUTOMATIC_ALERT_BATCH = 3;
/**
 * Runaway guard for one immediate dispatch. Each changed save is sent in that
 * request, with no delay and no daily cap. This does not hold posts for cron.
 */
export const MAX_RATE_POSTS_PER_DISPATCH = 20;
export const MAX_WEBHOOK_BYTES = 65_536;
export const MAX_ADMIN_BYTES = 16_384;

const EXCHANGE_KEY = /^[A-Za-z0-9-]{4,40}$/;
const LOGISTICS_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeliveryClassification = 'accepted' | 'rejected' | 'retryable' | 'unknown';

export type FanoutDecision = {
  status: 'sent' | 'queued' | 'failed' | 'needs_review';
  nextAttemptAt: number | null;
  error: string | null;
};

export function retryDelayMs(attempts: number): number {
  const shift = Math.max(0, Math.min(attempts - 1, 8));
  return Math.min(30_000 * 2 ** shift, 15 * 60_000);
}

export function settleFanout(input: {
  attempts: number;
  now: number;
  pending: number;
  deliveredCount: number;
  sawRetryable: boolean;
  sawUnknown: boolean;
  sawRejected: boolean;
  retryableCode: string | null;
  unknownCode: string | null;
  rejectedCode: string | null;
}): FanoutDecision {
  if (input.pending <= 0) return { status: 'sent', nextAttemptAt: null, error: null };
  if (input.sawUnknown) {
    return { status: 'needs_review', nextAttemptAt: null, error: input.unknownCode ?? 'telegram_unconfirmed' };
  }
  if (input.sawRetryable && !input.sawRejected && input.attempts < MAX_DELIVERY_ATTEMPTS) {
    return {
      status: 'queued',
      nextAttemptAt: input.now + retryDelayMs(input.attempts),
      error: input.retryableCode ?? 'telegram_http_429',
    };
  }
  if (input.sawRetryable && !input.sawRejected) {
    return { status: 'needs_review', nextAttemptAt: null, error: input.retryableCode ?? 'telegram_http_429' };
  }
  if (input.deliveredCount === 0 && input.sawRejected) {
    return { status: 'failed', nextAttemptAt: null, error: input.rejectedCode ?? 'telegram_rejected' };
  }
  return { status: 'needs_review', nextAttemptAt: null, error: input.rejectedCode ?? 'telegram_unconfirmed' };
}

export function settleSingle(input: {
  attempts: number;
  now: number;
  classification: DeliveryClassification;
  code: string | null;
}): FanoutDecision {
  if (input.classification === 'accepted') return { status: 'sent', nextAttemptAt: null, error: null };
  if (input.classification === 'retryable') {
    return settleFanout({
      attempts: input.attempts,
      now: input.now,
      pending: 1,
      deliveredCount: 0,
      sawRetryable: true,
      sawUnknown: false,
      sawRejected: false,
      retryableCode: input.code,
      unknownCode: null,
      rejectedCode: null,
    });
  }
  if (input.classification === 'unknown') {
    return { status: 'needs_review', nextAttemptAt: null, error: input.code ?? 'telegram_unconfirmed' };
  }
  return { status: 'failed', nextAttemptAt: null, error: input.code ?? 'telegram_rejected' };
}

export function alertIdentity(
  kind: 'exchange_request' | 'logistics_request' | 'support_request',
  recordKey: string,
): {
  dedupeKey: string;
  recordKey: string;
} | null {
  if (kind === 'exchange_request') {
    if (!EXCHANGE_KEY.test(recordKey)) return null;
    return { dedupeKey: `exchange:${recordKey}`, recordKey };
  }
  if (!LOGISTICS_KEY.test(recordKey)) return null;
  const key = recordKey.toLowerCase();
  const prefix = kind === 'support_request' ? 'support' : 'logistics';
  return { dedupeKey: `${prefix}:${key}`, recordKey: key };
}

export function isDeliveredStatus(status: string): boolean {
  return status === 'sent';
}
