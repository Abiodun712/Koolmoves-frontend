import { telegramWorker } from '../server/telegram/production';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramWorker(request);
  },
};
