import { respond } from './lib/core.mjs';

export default (req) => respond(req);

export const config = { path: '/api/*' };
