import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, glob, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.cache'), { recursive: true });
const temporary = await mkdtemp(join(root, '.cache/runtime-'));
const compiled = join(temporary, 'compiled');
const env = {
  ...process.env,
  NODE_ENV: 'test', NODE_OPTIONS: '', STORE_DRIVER: 'fs',
  DATA_DIR: join(temporary, 'data'), SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_BOOTSTRAP_USERNAME: 'RuntimeCheck', ADMIN_BOOTSTRAP_PASSWORD: randomBytes(32).toString('hex'),
  ADMIN_FORCE_PASSWORD_CHANGE: 'false', PUBLIC_BASE_URL: 'http://localhost:3000',
  COOKIE_SECURE: 'false', CACHE_SMAXAGE: '0', CACHE_SWR: '0', CDN_PURGE: 'off',
};
delete env.ADMIN_BOOTSTRAP_USERS;
delete env.DATABASE_URL;
delete env.BLOB_READ_WRITE_TOKEN;
delete env.VERCEL;

try {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '-p', join(root, 'tsconfig.runtime.json'), '--outDir', compiled], { cwd: root, stdio: 'inherit' });
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}\n');
  const entrypoints = ['api/admin.js', 'api/render.js'].map(file => pathToFileURL(join(compiled, file)).href);
  execFileSync(process.execPath, ['--input-type=module', '--eval',
    `await Promise.all(${JSON.stringify(entrypoints)}.map(url => import(url)))`], { cwd: compiled, env, stdio: 'inherit' });
  // Seed a fresh FS store separately. Seed JSON is a CLI input, outside the functions.
  await cp(join(root, 'content/seed'), join(compiled, 'content/seed'), { recursive: true });
  execFileSync(process.execPath, [join(compiled, 'scripts/seed.js')], { cwd: compiled, env, stdio: 'inherit' });

  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  for (const entry of ['api/admin.ts', 'api/render.ts']) {
    const staging = join(temporary, entry.replace('/', '-'));
    await mkdir(staging);
    await writeFile(join(staging, 'package.json'), '{"type":"module"}\n');
    // Only emitted JS and explicitly packaged assets enter each function image.
    // In particular, tsc's automatic JSON copy cannot hide a missing includeFiles.
    for await (const file of glob(['api/**/*.js', 'server/**/*.js', 'shared/**/*.js', 'tests/runtime-smoke.js'], { cwd: compiled })) {
      await mkdir(dirname(join(staging, file)), { recursive: true });
      await cp(join(compiled, file), join(staging, file));
    }
    const patterns = config.functions?.[entry]?.includeFiles ?? [];
    for await (const file of glob(patterns, { cwd: root })) {
      await mkdir(dirname(join(staging, file)), { recursive: true });
      await cp(join(root, file), join(staging, file), { recursive: true });
    }
    console.log(`Checking ${entry} package on ${process.version}`);
    execFileSync(process.execPath, [join(staging, 'tests/runtime-smoke.js')], { cwd: staging, env, stdio: 'inherit' });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
