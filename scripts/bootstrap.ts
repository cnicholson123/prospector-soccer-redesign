import { bootstrap } from '../server/auth/bootstrap';
import { loadConfig } from '../server/config';
import { createStore } from '../server/store';
const config = loadConfig();
console.log(await bootstrap(createStore(config), config) ? 'Missing bootstrap users created. Sign in with your configured credentials.' : 'Users already exist; bootstrap skipped.');
