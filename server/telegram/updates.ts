const CALLBACKS = new Set(['exchange', 'logistics', 'track', 'support']);
const COMMAND = /^\/(start|help|menu)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i;

export type CallbackName = 'exchange' | 'logistics' | 'track' | 'support';

export type ParsedUpdate =
  | { type: 'invalid' }
  | { type: 'ignore'; updateId: number; callbackId: string | null }
  | { type: 'menu'; updateId: number; chatId: string }
  | { type: 'callback'; updateId: number; chatId: string; userId: string | null; callbackId: string; data: CallbackName }
  | { type: 'text'; updateId: number; chatId: string; userId: string | null; text: string }
  | { type: 'unreadable'; updateId: number; chatId: string };

export function parseUpdate(body: unknown): ParsedUpdate {
  if (!isRecord(body) || !isUpdateId(body.update_id)) return { type: 'invalid' };
  const updateId = body.update_id;
  if (isRecord(body.callback_query)) return parseCallback(updateId, body.callback_query);
  if (isRecord(body.message)) return parseMessage(updateId, body.message);
  return { type: 'ignore', updateId, callbackId: null };
}

function parseCallback(updateId: number, query: Record<string, unknown>): ParsedUpdate {
  const callbackId = typeof query.id === 'string' && query.id.length > 0 && query.id.length <= 128 ? query.id : null;
  const message = isRecord(query.message) ? query.message : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const chatId = chat && chat.type === 'private' ? positiveId(chat.id) : null;
  const data = typeof query.data === 'string' && CALLBACKS.has(query.data) ? (query.data as CallbackName) : null;
  if (!callbackId || !chatId || !data) return { type: 'ignore', updateId, callbackId };
  return {
    type: 'callback',
    updateId,
    chatId,
    userId: isRecord(query.from) ? positiveId(query.from.id) : null,
    callbackId,
    data,
  };
}

function parseMessage(updateId: number, message: Record<string, unknown>): ParsedUpdate {
  const chat = isRecord(message.chat) ? message.chat : null;
  if (!chat || chat.type !== 'private') return { type: 'ignore', updateId, callbackId: null };
  const chatId = positiveId(chat.id);
  if (!chatId) return { type: 'ignore', updateId, callbackId: null };
  const userId = isRecord(message.from) ? positiveId(message.from.id) : null;
  if (typeof message.text === 'string') {
    if (COMMAND.test(message.text.trim())) return { type: 'menu', updateId, chatId };
    return { type: 'text', updateId, chatId, userId, text: message.text.slice(0, 4000) };
  }
  return { type: 'unreadable', updateId, chatId };
}

function positiveId(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return String(value);
}

function isUpdateId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
