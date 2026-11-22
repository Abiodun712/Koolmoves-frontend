import { telegramWebhook } from '../server/telegram/production';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramWebhook(request);
  },
};
