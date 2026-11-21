import { passkeyFetch } from '../server/passkeys/production';

export default {
  fetch(request: Request): Promise<Response> {
    return passkeyFetch(request);
  },
};
