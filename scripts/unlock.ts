import { createStore } from '../server/store/index.js';
import { loadConfig } from '../server/config.js';
import { username } from '../server/store/identifiers.js';
import { audit } from '../server/audit.js';
const name = username(process.argv[2]);
const store = createStore(loadConfig());
try {
  const user = await store.getUserByUsername(name);
  if (!user) throw new Error('User not found');
  await store.unlockLogin(name, audit({ id: 'system', displayName: 'Local operator' }, 'auth.unlock', { meta: { userId: user.id, username: name } }));
  console.info(`Unlocked ${name}`);
} finally { await store.close(); }
