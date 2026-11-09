import { randomBytes, randomInt } from 'node:crypto';
import { collections, type CollectionName } from '../../shared/schema';
const prefixes: Partial<Record<CollectionName, string>> = {
  events: 'evt', callouts: 'call', teams: 'team', results: 'res', boardMembers: 'board',
  sponsors: 'spon', sponsorTiers: 'tier', documents: 'doc', faqs: 'faq', media: 'media',
};
export function createId(collection: CollectionName): string {
  if (collections[collection].kind === 'singleton') return collection;
  return `${prefixes[collection] ?? collection}_${randomBytes(12).toString('base64url')}`;
}
export function createListKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
