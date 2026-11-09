import { copyFile, mkdir } from 'node:fs/promises';
const pages = ['index', 'recreational', 'competitive', 'referees', 'sponsors', 'board', 'resources', 'about'];
if (process.env.UPDATE_GOLDEN !== '1') throw new Error('Golden updates require UPDATE_GOLDEN=1 and review');
await mkdir('tests/golden', { recursive: true });
for (const page of pages) await copyFile(`docs/${page}.html`, `tests/golden/${page}.html`);
console.log(`Exported ${pages.length} unchanged legacy goldens`);
