import type { CollectionName } from '../../shared/schema.js';
import type { Snapshot } from '../../shared/types.js';
import { effectiveSnapshot } from '../content/scheduled-view.js';
import { html, raw, type Html } from './html.js';
import { richtext } from './richtext.js';
import { safeUrl } from './links.js';
import { editable } from './editable.js';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Schema paths, rather than untyped property access, are also the inline editor's addresses. */
export class DocumentView {
  constructor(readonly view: SnapshotView, readonly collection: CollectionName, readonly id: string,
    private readonly data: unknown, private readonly prefix = '') {}
  value(path: string): unknown {
    return path ? path.split('.').reduce<unknown>((current, key) => object(current)[key], this.data) : this.data;
  }
  text(path: string): string { const value = this.value(path); return typeof value === 'string' ? value : ''; }
  number(path: string): number { const value = this.value(path); return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
  boolean(path: string, fallback = false): boolean { const value = this.value(path); return typeof value === 'boolean' ? value : fallback; }
  list(path: string): DocumentView[] {
    const value = this.value(path);
    return Array.isArray(value) ? value.map((item: unknown, index) => new DocumentView(this.view, this.collection, this.id, item,
      `${this.prefix}${path}[${typeof object(item)._key === 'string' ? object(item)._key : index}].`)) : [];
  }
  strings(path: string): string[] { const value = this.value(path); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  rich(path: string, inline = false): Html {
    const output = richtext(this.text(path), inline);
    if (!inline && this.view.edit) return raw(output.value.replace(/^<(p|ul)>/, `<$1${this.edit(path)}>`));
    return output;
  }
  edit(path: string): Html { return editable(this.view.edit, this.collection, this.id, this.prefix + path); }
  url(path: string): string { return safeUrl(this.text(path)); }
  email(path: string): string { return safeUrl(`mailto:${this.text(path)}`); }
  external(path: string): Html {
    return this.boolean(path ? `${path}.external` : 'external') ? html` target="_blank" rel="noopener"` : html``;
  }
  image(path: string): string {
    const media = this.view.doc('media', this.text(`${path}.mediaId`));
    return safeUrl(media.text('variants.web') || media.text('variants.original'));
  }
  imageStyle(path: string): Html {
    const media = this.view.doc('media', this.text(`${path}.mediaId`));
    if (media.value('focal') === undefined) return html``;
    const clamp = (n: number) => Math.max(0, Math.min(1, n)) * 100;
    return html` style="object-position: ${clamp(media.number('focal.x'))}% ${clamp(media.number('focal.y'))}%"`;
  }
  amount(path: string): string { return this.number(`${path}.amount`).toLocaleString('en-US'); }
  money(path: string): string {
    const max = this.value(`${path}.max`);
    return `$${this.amount(path)}` + (typeof max === 'number' ? `–$${max.toLocaleString('en-US')}` : '');
  }
  average(path: string): number {
    const amount = this.number(`${path}.amount`);
    const maximum = this.value(`${path}.max`);
    return (amount + (typeof maximum === 'number' ? maximum : amount)) / 2;
  }
  color(path: string): string { const value = this.text(path); return /^c[1-9][0-9]*$/.test(value) ? value : 'c1'; }
  swatch(path: string): string {
    const value = this.text(path);
    return /^(?:var\(--[a-z0-9-]+\)|#[a-fA-F0-9]{3,8}|rgb\([\d. %/]+\))$/.test(value) ? value : 'currentColor';
  }
}
export class SnapshotView {
  readonly snapshot: Snapshot;
  constructor(snapshot: Snapshot, readonly now = new Date(), readonly edit = false, readonly timeZone = 'America/Los_Angeles') { this.snapshot = effectiveSnapshot(snapshot, now); }
  doc(collection: CollectionName, id: string): DocumentView {
    const doc = this.snapshot.docs[collection]?.find(item => item.id === id);
    const media = collection === 'media' ? this.snapshot.media?.[id] : undefined;
    return new DocumentView(this, collection, id, doc?.data ?? (media ? { ...media, variants: { web: media.url, original: media.url, small: media.small } } : {}));
  }
  collection(collection: CollectionName): DocumentView[] {
    return [...(this.snapshot.docs[collection] ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
      .map(doc => new DocumentView(this, collection, doc.id, doc.data));
  }
  references(doc: DocumentView, path: string, collection: CollectionName): DocumentView[] {
    return doc.strings(path).filter(id => this.snapshot.docs[collection]?.some(item => item.id === id)).map(id => this.doc(collection, id));
  }
  reference(doc: DocumentView, path: string, collection: CollectionName): DocumentView { return this.doc(collection, doc.text(path)); }
  events(): DocumentView[] {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now);
    const setting = this.doc('site', 'site').value('events.hidePastAfterDays');
    const days = typeof setting === 'number' ? setting : 60;
    const cutoff = new Date(Date.parse(day + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
    return this.collection('events').filter(doc => doc.boolean('showOnHome', true) && doc.text('date') >= cutoff)
      .sort((a, b) => a.text('date').localeCompare(b.text('date')) || a.text('time').localeCompare(b.text('time')));
  }
  callouts(): DocumentView[] {
    return this.collection('callouts').filter(doc => doc.boolean('active', true)
      && (!doc.text('startsAt') || Date.parse(doc.text('startsAt')) <= this.now.getTime())
      && (!doc.text('endsAt') || Date.parse(doc.text('endsAt')) > this.now.getTime()));
  }
  sponsors(featured: boolean): DocumentView[] {
    return this.collection('sponsors').filter(doc => doc.boolean('active', true) && this.doc('sponsorTiers', doc.text('tier')).boolean('featured') === featured);
  }
  documents(category: string): DocumentView[] { return this.collection('documents').filter(doc => doc.text('category') === category && doc.boolean('showInLibrary', true)); }
}
