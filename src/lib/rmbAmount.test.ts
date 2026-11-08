import { describe, expect, it } from 'vitest';
import {
  convertDraft,
  convertWithPublishedRate,
  formatDerivedAmount,
  isAmountDraft,
  nextAmountDraft,
  parseAmountDraft,
  roundMoney,
  sanitizePastedAmount,
} from './rmbAmount';

describe('amount drafts', () => {
  it('allows empty, decimal, and zero drafts and rejects invalid text', () => {
    expect(isAmountDraft('')).toBe(true);
    expect(isAmountDraft('.')).toBe(true);
    expect(isAmountDraft('0')).toBe(true);
    expect(isAmountDraft('0.')).toBe(true);
    expect(isAmountDraft('10.5')).toBe(true);
    expect(isAmountDraft('100.10')).toBe(true);
    expect(isAmountDraft('.5')).toBe(true);

    expect(isAmountDraft('-1')).toBe(false);
    expect(isAmountDraft('1.234')).toBe(false);
    expect(isAmountDraft('12a')).toBe(false);
    expect(isAmountDraft('1e2')).toBe(false);
    expect(isAmountDraft('Infinity')).toBe(false);
    expect(isAmountDraft('NaN')).toBe(false);
    expect(isAmountDraft(' 1')).toBe(false);
    expect(nextAmountDraft('1.23', '1.234')).toBe('1.23');
    expect(nextAmountDraft('100.', '100.')).toBe('100.');
    expect(nextAmountDraft('', '-5')).toBe('');
  });

  it('parses empty, incomplete, zero, and decimal drafts', () => {
    expect(parseAmountDraft('')).toEqual({ state: 'empty' });
    expect(parseAmountDraft('.')).toEqual({ state: 'incomplete' });
    expect(parseAmountDraft('0')).toEqual({ state: 'ok', value: 0 });
    expect(parseAmountDraft('0.')).toEqual({ state: 'ok', value: 0 });
    expect(parseAmountDraft('10.5')).toEqual({ state: 'ok', value: 10.5 });
    expect(parseAmountDraft('100.')).toEqual({ state: 'ok', value: 100 });
    expect(parseAmountDraft('-1')).toEqual({ state: 'invalid' });
    expect(parseAmountDraft('Infinity')).toEqual({ state: 'invalid' });
  });

  it('cleans a pasted naira or RMB amount', () => {
    expect(sanitizePastedAmount('₦1,250.50')).toBe('1250.50');
    expect(sanitizePastedAmount('RMB 10')).toBe('10');
    expect(sanitizePastedAmount('12a')).toBeNull();
    expect(sanitizePastedAmount('-5')).toBeNull();
  });
});

describe('conversion and rounding', () => {
  it('converts both directions with the same published rate', () => {
    expect(convertWithPublishedRate(10, 200, 'rmb-to-ngn')).toBe(2000);
    expect(convertWithPublishedRate(2000, 200, 'ngn-to-rmb')).toBe(10);
    expect(convertDraft('10.5', 200, 'rmb-to-ngn')).toBe('2100.00');
    expect(convertDraft('100', 200, 'ngn-to-rmb')).toBe('0.50');
    expect(convertDraft('0', 200, 'ngn-to-rmb')).toBe('0.00');
    expect(convertDraft('', 200, 'ngn-to-rmb')).toBe('');
    expect(convertDraft('.', 200, 'rmb-to-ngn')).toBe('');
    expect(convertDraft('-5', 200, 'rmb-to-ngn')).toBe('');
  });

  it('rounds half-up to 2 decimals and does not echo a rounded value back into the source', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(10 / 3)).toBe(3.33);
    expect(roundMoney(2 / 3)).toBe(0.67);
    expect(formatDerivedAmount(100 / 3)).toBe('33.33');
    expect(convertDraft('100', 3, 'ngn-to-rmb')).toBe('33.33');
    expect(convertDraft('100.10', 3, 'ngn-to-rmb')).toBe('33.37');
    expect(convertDraft('1', 1.005, 'rmb-to-ngn')).toBe('1.01');
  });

  it('returns nothing for a non-positive, non-finite, or overflowing rate', () => {
    expect(convertWithPublishedRate(10, 0, 'rmb-to-ngn')).toBeNull();
    expect(convertWithPublishedRate(10, -5, 'rmb-to-ngn')).toBeNull();
    expect(convertWithPublishedRate(10, Number.NaN, 'ngn-to-rmb')).toBeNull();
    expect(convertWithPublishedRate(10, Number.POSITIVE_INFINITY, 'rmb-to-ngn')).toBeNull();
    expect(convertWithPublishedRate(Number.POSITIVE_INFINITY, 10, 'rmb-to-ngn')).toBeNull();
    expect(convertWithPublishedRate(-1, 10, 'ngn-to-rmb')).toBeNull();
    expect(convertDraft('100', 0, 'ngn-to-rmb')).toBe('');
    expect(convertDraft('100', Number.NaN, 'ngn-to-rmb')).toBe('');
    expect(roundMoney(Number.NaN)).toBeNull();
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBeNull();
    expect(roundMoney(-1)).toBeNull();
  });
});
