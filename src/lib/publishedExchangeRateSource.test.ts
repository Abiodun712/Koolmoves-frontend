import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls } = vi.hoisted(() => {
  const calls: string[] = [];
  return { calls };
});

vi.mock('./supabaseClient', () => {
  const builder = {
    select(columns: string) {
      calls.push(`select:${columns}`);
      return builder;
    },
    eq(column: string, value: string) {
      calls.push(`eq:${column}=${value}`);
      return builder;
    },
    maybeSingle() {
      calls.push('maybeSingle');
      return Promise.resolve({ data: { value: '210' }, error: null });
    },
    insert() {
      calls.push('insert');
      throw new Error('write');
    },
    update() {
      calls.push('update');
      throw new Error('write');
    },
    upsert() {
      calls.push('upsert');
      throw new Error('write');
    },
    delete() {
      calls.push('delete');
      throw new Error('write');
    },
  };
  return {
    supabase: {
      from: vi.fn((table: string) => {
        calls.push(`from:${table}`);
        return builder;
      }),
    },
  };
});

describe('loadPublishedPlatformRate', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('reads only site_settings.exchange_rate and does not write', async () => {
    const { supabase } = await import('./supabaseClient');
    expect(vi.isMockFunction(supabase.from)).toBe(true);
    const { loadPublishedPlatformRate } = await import('./publishedExchangeRateSource');
    await expect(loadPublishedPlatformRate()).resolves.toEqual({ status: 'ready', rate: 210 });
    expect(calls).toEqual(['from:site_settings', 'select:value', 'eq:key=exchange_rate', 'maybeSingle']);
  });
});
