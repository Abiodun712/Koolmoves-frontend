import { timingSafeEqual } from 'node:crypto';

const PUBLIC_ERROR = /^[a-z0-9_]{1,40}$/;

export function secretEquals(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length === 0 || left.length !== right.length) {
    timingSafeEqual(Buffer.alloc(32, 1), Buffer.alloc(32, 1));
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Plain text only. Control characters are removed; markup characters are kept as text. */
export function sanitizePlainText(input: string, max = 1000): string {
  let cleaned = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    if (!isControl) cleaned += char;
  }
  return cleaned.trim().slice(0, max);
}

export function publicError(code: string | null | undefined): string | null {
  if (!code) return null;
  return PUBLIC_ERROR.test(code) ? code : 'error';
}

export function safeToken(value: string, fallback: string): string {
  const cleaned = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(cleaned) ? cleaned : fallback;
}

export function maskChatId(chatId: string): string {
  const tail = chatId.replace(/\D/g, '').slice(-4).padStart(4, '•');
  return `•••${tail}`;
}

export function requestHost(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  return forwarded.split(',')[0]?.trim().toLowerCase().replace(/:\d+$/, '') ?? '';
}

export function hostAllowed(requestHost: string, siteHost: string): boolean {
  if (!requestHost || !siteHost) return false;
  if (requestHost === siteHost) return true;
  if (siteHost.startsWith('www.') && requestHost === siteHost.slice(4)) return true;
  if (requestHost === `www.${siteHost}`) return true;
  return false;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1] || match[1].length < 16 || match[1].length > 8192) return null;
  return match[1];
}
