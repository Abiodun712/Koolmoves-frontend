import { telegramAdmin } from '../server/telegram/production.js';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramAdmin(request);
  },
};
