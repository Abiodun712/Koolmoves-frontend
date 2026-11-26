import { passkeyFetch } from '../server/passkeys/production.js';

export default {
  fetch(request: Request): Promise<Response> {
    return passkeyFetch(request);
  },
};
