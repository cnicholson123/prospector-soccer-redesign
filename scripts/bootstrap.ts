import { bootstrap } from '../server/auth/bootstrap.js';
import { loadConfig } from '../server/config.js';
import { createStore } from '../server/store/index.js';
const config = loadConfig();
console.log(await bootstrap(createStore(config), config) ? 'Missing bootstrap users created. Sign in with your configured credentials.' : 'Users already exist; bootstrap skipped.');
