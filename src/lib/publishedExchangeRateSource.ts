import { supabase } from './supabaseClient';
import {
  PUBLISHED_EXCHANGE_RATE_KEY,
  fetchPublishedExchangeRate,
  type PublishedRate,
} from './publishedExchangeRate';

/**
 * Published platform rate: public.site_settings key "exchange_rate".
 * Same row the admin exchange screen writes and the signed-in exchange screen reads.
 * Select only — this does not insert, update, or upsert.
 */
export function loadPublishedPlatformRate(): Promise<PublishedRate> {
  return fetchPublishedExchangeRate(async () => {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', PUBLISHED_EXCHANGE_RATE_KEY)
      .maybeSingle();
    return {
      data: data ? { value: data.value } : null,
      error: error ? { message: error.message } : null,
    };
  });
}
