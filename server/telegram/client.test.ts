// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTelegramClient } from './client';

const token = '123456789:AAHexampleTokenValueForTestsOnly';

describe('createTelegramClient', () => {
  it('sends plain text and does not return the token or response body', async () => {
    const client = createTelegramClient(token, async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.parse_mode).toBeUndefined();
      expect(payload.text).toBe('<b>not bold</b>');
      return new Response(JSON.stringify({ ok: true, result: { message_id: 4 }, description: token }), { status: 200 });
    });
    const result = await client.sendMessage('10001', '<b>not bold</b>');
    expect(result).toEqual({ classification: 'accepted', messageId: '4', code: null });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('parse_mode');
  });

  it('classifies rejection, rate limit, server error, and timeout without echoing the body', async () => {
    const bodies = ['bad request ' + token, 'slow ' + token, 'down ' + token];
    const statuses = [400, 429, 500];
    let index = 0;
    const client = createTelegramClient(token, async () => {
      const status = statuses[index] ?? 500;
      const body = bodies[index] ?? token;
      index += 1;
      return new Response(body, { status });
    });
    expect((await client.sendMessage('1', 'a')).classification).toBe('rejected');
    expect((await client.sendMessage('1', 'a')).classification).toBe('retryable');
    expect((await client.sendMessage('1', 'a')).classification).toBe('unknown');
    const aborted = createTelegramClient(token, async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const timeout = await aborted.sendMessage('1', 'a');
    expect(timeout).toEqual({ classification: 'unknown', messageId: null, code: 'telegram_timeout' });
    expect(JSON.stringify(timeout)).not.toContain(token);
  });
});
