import { loadPasskeyConfig } from './config';
import { json } from './routes';
import { createPasskeyApi } from './routes';
import {
  createServiceClient,
  createSupabaseAccountLookup,
  createSupabasePasskeyStore,
  createSupabaseSessionIssuer,
} from './supabase';

const loaded = loadPasskeyConfig(process.env);

let api: ReturnType<typeof createPasskeyApi> | undefined;

export function passkeyFetch(request: Request): Promise<Response> {
  if (!loaded.ok) return Promise.resolve(json(503, { error: 'not_configured' }));
  return passkeyApi().fetch(request);
}

function passkeyApi(): ReturnType<typeof createPasskeyApi> {
  if (!loaded.ok) throw new Error('passkey configuration is missing');
  if (!api) {
    const config = loaded.config;
    const admin = createServiceClient(config, config.serviceRoleKey);
    const readers = createServiceClient(config, config.supabaseAnonKey);
    api = createPasskeyApi({
      rp: { rpId: config.rpId, rpName: config.rpName, origins: config.origins },
      store: createSupabasePasskeyStore(admin),
      accounts: createSupabaseAccountLookup(readers, config.serviceRoleKey),
      sessions: createSupabaseSessionIssuer(admin, () => createServiceClient(config, config.supabaseAnonKey)),
    });
  }
  return api;
}
