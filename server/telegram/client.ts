export type TelegramCallResult = {
  classification: 'accepted' | 'rejected' | 'retryable' | 'unknown';
  messageId: string | null;
  code: string | null;
};

export type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramClient = {
  sendMessage(chatId: string, text: string, replyMarkup?: ReplyMarkup): Promise<TelegramCallResult>;
  answerCallback(callbackQueryId: string): Promise<TelegramCallResult>;
};

export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  return {
    sendMessage(chatId, text, replyMarkup) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      return callTelegram(fetchImpl, token, 'sendMessage', body);
    },
    answerCallback(callbackQueryId) {
      return callTelegram(fetchImpl, token, 'answerCallbackQuery', { callback_query_id: callbackQueryId });
    },
  };
}

export function disabledTelegramClient(): TelegramClient {
  return {
    async sendMessage() {
      throw new Error('telegram_disabled');
    },
    async answerCallback() {
      throw new Error('telegram_disabled');
    },
  };
}

async function callTelegram(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.ok) {
      const messageId = await readMessageId(response);
      return { classification: 'accepted', messageId, code: null };
    }
    await response.arrayBuffer().catch(() => undefined);
    if (response.status === 429) {
      return { classification: 'retryable', messageId: null, code: 'telegram_http_429' };
    }
    if (response.status >= 500) {
      return { classification: 'unknown', messageId: null, code: 'telegram_http_500' };
    }
    if (response.status >= 400 && response.status <= 499) {
      return { classification: 'rejected', messageId: null, code: 'telegram_rejected' };
    }
    return { classification: 'unknown', messageId: null, code: 'telegram_unconfirmed' };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      classification: 'unknown',
      messageId: null,
      code: aborted ? 'telegram_timeout' : 'telegram_network',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readMessageId(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) return null;
    const result = Reflect.get(payload, 'result');
    if (typeof result !== 'object' || result === null) return null;
    const messageId = Reflect.get(result, 'message_id');
    if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId)) return null;
    return String(messageId);
  } catch {
    return null;
  }
}
