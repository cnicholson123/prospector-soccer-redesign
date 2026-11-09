import { adminApp } from '../server/http/hono-app';
export default { fetch: (request: Request) => adminApp.fetch(request) };
