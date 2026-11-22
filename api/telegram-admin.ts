import { telegramAdmin } from '../server/telegram/production';

export default {
  fetch(request: Request): Promise<Response> {
    return telegramAdmin(request);
  },
};
