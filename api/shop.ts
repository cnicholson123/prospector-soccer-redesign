import { shopApp } from '../server/shop/http/app.js';
export default { fetch: (request: Request) => shopApp.fetch(request) };
