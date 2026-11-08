import { describe, expect, it, vi } from 'vitest';
import {
  fetchPublishedExchangeRate,
  formatPlatformRateLine,
  parsePublishedExchangeRate,
} from './publishedExchangeRate';

describe('parsePublishedExchangeRate', () => {
  it('accepts a positive published decimal', () => {
    expect(parsePublishedExchangeRate('210')).toEqual({ status: 'ready', rate: 210 });
    expect(parsePublishedExchangeRate('210.50')).toEqual({ status: 'ready', rate: 210.5 });
    expect(parsePublishedExchangeRate(' 1250.5 ')).toEqual({ status: 'ready', rate: 1250.5 });
    expect(parsePublishedExchangeRate('1,250')).toEqual({ status: 'ready', rate: 1250 });
    expect(parsePublishedExchangeRate(210)).toEqual({ status: 'ready', rate: 210 });
  });

  it('rejects empty, zero, negative, non-finite, and junk instead of inventing a rate', () => {
    for (const value of ['', '   ', '0', '0.0', '0.00', '-1', '-0.5', 'abc', '210abc', '1e2', 'Infinity', 'NaN', '1,25', null, undefined, true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, 0]) {
      expect(parsePublishedExchangeRate(value)).toEqual({ status: 'unavailable' });
    }
  });
});

describe('formatPlatformRateLine', () => {
  it('uses the published rate shape', () => {
    expect(formatPlatformRateLine(210)).toBe('1 RMB = ₦210');
    expect(formatPlatformRateLine(210.5)).toBe('1 RMB = ₦210.5');
    expect(formatPlatformRateLine(1250.5)).toBe('1 RMB = ₦1,250.5');
  });

  it('does not format a non-positive rate', () => {
    expect(formatPlatformRateLine(0)).toBeNull();
    expect(formatPlatformRateLine(-1)).toBeNull();
    expect(formatPlatformRateLine(Number.NaN)).toBeNull();
    expect(formatPlatformRateLine(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('fetchPublishedExchangeRate', () => {
  it('waits for the query and returns the published rate', async () => {
    let release: (value: { data: { value: string } | null; error: null }) => void = () => {};
    const pending = new Promise<{ data: { value: string } | null; error: null }>((resolve) => {
      release = resolve;
    });
    const query = vi.fn(() => pending);
    const result = fetchPublishedExchangeRate(query);
    expect(query).toHaveBeenCalledOnce();
    release({ data: { value: '250' }, error: null });
    await expect(result).resolves.toEqual({ status: 'ready', rate: 250 });
  });

  it('is unavailable when the read fails, is empty, or is non-positive', async () => {
    await expect(fetchPublishedExchangeRate(async () => {
      throw new Error('offline');
    })).resolves.toEqual({ status: 'unavailable' });

    await expect(fetchPublishedExchangeRate(async () => ({
      data: null,
      error: { message: 'permission denied' },
    }))).resolves.toEqual({ status: 'unavailable' });

    await expect(fetchPublishedExchangeRate(async () => ({
      data: null,
      error: null,
    }))).resolves.toEqual({ status: 'unavailable' });

    await expect(fetchPublishedExchangeRate(async () => ({
      data: { value: '0' },
      error: null,
    }))).resolves.toEqual({ status: 'unavailable' });

    await expect(fetchPublishedExchangeRate(async () => ({
      data: { value: '-4' },
      error: null,
    }))).resolves.toEqual({ status: 'unavailable' });
  });

  it('uses a later published value when the source changes', async () => {
    const first = await fetchPublishedExchangeRate(async () => ({ data: { value: '200' }, error: null }));
    const second = await fetchPublishedExchangeRate(async () => ({ data: { value: '250.5' }, error: null }));
    expect(first).toEqual({ status: 'ready', rate: 200 });
    expect(second).toEqual({ status: 'ready', rate: 250.5 });
  });
});
