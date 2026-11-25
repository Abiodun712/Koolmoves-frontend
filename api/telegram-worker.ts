import { telegramWorker } from '../server/telegram/production.js';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramWorker(request);
  },
};
