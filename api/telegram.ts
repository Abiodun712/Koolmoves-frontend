import { telegramWebhook } from '../server/telegram/production.js';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramWebhook(request);
  },
};
