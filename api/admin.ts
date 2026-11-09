import { handle } from 'hono/vercel';
import { adminApp } from '../server/http/hono-app';
export default handle(adminApp);
