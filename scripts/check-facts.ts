import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { pageNames } from '../shared/schema.js';
import { loadSeed, seedSnapshot } from './seed.js';
import { renderPage } from '../server/render/handler.js';

function text(value: string): string {
  return value.replace(/<wbr>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/\$\s+/g, '$').toLowerCase();
}
/** Inventory URLs, email addresses, prices and named people/businesses are checked independently of goldens. */
export function checkFacts(inventory: string, rendered: string): { count: number; missing: string[] } {
  const facts = new Set<string>();
  for (const match of inventory.matchAll(/https?:\/\/[^\s<>]+/g)) facts.add(match[0].replace(/[).,;:]+$/, ''));
  for (const match of inventory.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) facts.add(match[0]);
  for (const match of inventory.matchAll(/\$[\d,]+(?:[––-]\$?[\d,]+)?/g)) facts.add(match[0]);
  const board = inventory.split('## Board Members')[1]?.split('## ')[0] ?? '';
  for (const line of board.split('\n')) {
    const name = /^- .*? — (.*?) — /.exec(line)?.[1];
    if (name && name !== '(vacant)') facts.add(name);
  }
  const competitive = inventory.split('## Competitive Program')[1]?.split('## Referees')[0] ?? '';
  for (const line of competitive.split('\n')) {
    const coaches = /^\s+- U\d+ (?:Girls|Boys) — \w+ — (.*)/.exec(line)?.[1];
    for (const name of coaches?.split(', ') ?? []) facts.add(name);
  }
  const sponsors = inventory.split('## Sponsors')[1]?.split('## Board Members')[0] ?? '';
  const teams = /- Team sponsors: (.*)/.exec(sponsors)?.[1] ?? '';
  for (const name of teams.replace(/\.$/, '').split('; ')) if (name) facts.add(name);
  const gold = /- Gold sponsors: (.*)/.exec(sponsors)?.[1] ?? '';
  for (const part of gold.split(' · ')) { const name = part.split(' https:')[0]; if (name) facts.add(name); }
  for (const match of inventory.matchAll(/"(Sharks|Arsenal|Pumas)"/g)) facts.add(match[1]);
  const generalContact = /General contact: ([^,]+),/.exec(inventory)?.[1];
  if (generalContact) facts.add(generalContact);
  for (const place of ['Cameron Park', 'Shingle Springs', 'Rescue', 'California', 'Rasmussen Park', 'Yoga Berry', 'Pizza Factory', "Mountain Mike's", 'Indian Creek', 'Golden Sierra', 'Los Pinos']) facts.add(place);
  const haystack = text(rendered) + ' ' + rendered.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/[‘’]/g, "'").replace(/[–—]/g, '-').toLowerCase();
  return { count: facts.size, missing: [...facts].filter(fact => !haystack.includes(text(fact))) };
}
export async function verifyFacts(): Promise<{ count: number; missing: string[] }> {
  const snapshot = seedSnapshot(await loadSeed());
  return checkFacts(await readFile('content/content.md', 'utf8'), pageNames.map(page => renderPage(snapshot, page, { now: new Date('2026-11-09T12:00:00Z') })).join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyFacts();
  if (result.missing.length) { console.error('Missing inventory facts:', result.missing); process.exitCode = 1; }
  else console.log(`Content inventory PASS (${result.count} URLs, emails, prices, names and places)`);
}
