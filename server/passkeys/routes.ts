import { createHash } from 'node:crypto';
import type { PasskeyFailure } from './service.js';
import { createPasskeyService } from './service.js';
import type { AccountLookup, RelyingParty, SessionIssuer } from './service.js';
import type { PasskeyStore } from './store.js';

const MAX_BODY_BYTES = 16_384;

export function createPasskeyApi(deps: {
  rp: RelyingParty;
  store: PasskeyStore;
  accounts: AccountLookup;
  sessions: SessionIssuer;
  now?: () => Date;
}) {
  const service = createPasskeyService(deps);

  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return json(405, { error: 'invalid_request' });
      const origin = request.headers.get('origin');
      if (!origin || !deps.rp.origins.includes(origin)) return json(403, { error: 'origin' });
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        return json(400, { error: 'invalid_request' });
      }

      let text: string;
      try {
        text = await request.text();
      } catch {
        return json(400, { error: 'invalid_request' });
      }
      if (text.length > MAX_BODY_BYTES) return json(400, { error: 'invalid_request' });

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: 'invalid_request' });
      }
      if (!isRecord(body) || typeof body.op !== 'string') return json(400, { error: 'invalid_request' });

      const ipHash = createHash('sha256').update(clientIp(request)).digest('hex');
      const accessToken = bearer(request);

      switch (body.op) {
        case 'authenticate-options': {
          const result = await service.authenticationOptions(ipHash);
          return result.ok ? json(200, { options: result.value }) : failure(result.error);
        }
        case 'authenticate-verify': {
          const result = await service.authenticate(body.credential);
          if (!result.ok) return failure(result.error);
          return json(200, {
            accessToken: result.value.accessToken,
            refreshToken: result.value.refreshToken,
          });
        }
        case 'register-options': {
          if (!accessToken) return json(401, { error: 'unauthorized' });
          const result = await service.registrationOptions(accessToken, body.deviceLabel, ipHash);
          return result.ok ? json(200, { options: result.value }) : failure(result.error);
        }
        case 'register-verify': {
          if (!accessToken) return json(401, { error: 'unauthorized' });
          const result = await service.register(accessToken, body.credential);
          return result.ok ? json(200, { credential: result.value }) : failure(result.error);
        }
        case 'list': {
          if (!accessToken) return json(401, { error: 'unauthorized' });
          const result = await service.list(accessToken);
          return result.ok ? json(200, { credentials: result.value }) : failure(result.error);
        }
        case 'revoke': {
          if (!accessToken) return json(401, { error: 'unauthorized' });
          const result = await service.revoke(accessToken, body.credentialId);
          return result.ok ? json(200, result.value) : failure(result.error);
        }
        default:
          return json(400, { error: 'invalid_request' });
      }
    },
  };
}

function failure(error: PasskeyFailure): Response {
  if (error === 'storage_unavailable') return json(503, { error: 'not_configured' });
  return json(statusFor(error), { error });
}

function statusFor(error: PasskeyFailure): number {
  switch (error) {
    case 'unauthorized':
      return 401;
    case 'rate_limited':
      return 429;
    case 'too_many_passkeys':
      return 409;
    case 'unconfirmed':
      return 403;
    case 'storage_unavailable':
      return 503;
    default:
      return 400;
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1] || match[1].length < 20 || match[1].length > 8192) return null;
  return match[1];
}

function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 200);
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || 'unknown').slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
