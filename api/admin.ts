import { adminApp } from '../server/http/hono-app.js';
export default { fetch: (request: Request) => adminApp.fetch(request) };
