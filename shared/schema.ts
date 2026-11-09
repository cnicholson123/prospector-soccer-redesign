export const SCHEMA_VERSION = 1;
/** Shared by validation and the admin form engine. System records are separate. */
export const pageNames = ['home', 'recreational', 'competitive', 'referees', 'sponsors', 'board', 'resources', 'about'] as const;
export type PageName = typeof pageNames[number];
export const collectionNames = ['site', ...pageNames.filter(name => name !== 'sponsors'), 'sponsorsPage', 'sponsors', 'events', 'callouts', 'teams', 'results', 'boardMembers', 'sponsorTiers', 'documents', 'faqs', 'media'] as const;
export type CollectionName = typeof collectionNames[number];
export const systemCollectionNames = ['users', 'sessions', 'revisions', 'publishes', 'audit', 'loginAttempts', 'scheduled', 'linkChecks', 'snapshots'] as const;
// Stable names for the SVG registry extracted in Phase 2. Never accept arbitrary SVG.
export const iconNames = ['arrow-right', 'arrow-up-right', 'calendar', 'flag', 'ball', 'users', 'check', 'book', 'pin', 'plus', 'clock', 'mail', 'shield', 'heart', 'trophy', 'menu', 'close', 'facebook', 'instagram', 'tiktok', 'key', 'waving-flag', 'arrow-up', 'contours', 'search', 'calendar-date'] as const;
interface FieldOptions {
  label?: string; help?: string; group?: string; width?: 'half' | 'full'; editable?: 'inline';
  required?: boolean; default?: unknown; defaultFrom?: string;
}
export type Field = FieldOptions & (
  | { type: 'text'; maxLength?: number; multiline?: boolean; placeholder?: string }
  | { type: 'richtext'; inline?: boolean }
  | { type: 'url'; allowMailto?: boolean; allowRelative?: boolean }
  | { type: 'email' | 'date' | 'time' | 'datetime' | 'money' | 'percent' | 'month' | 'boolean' | 'icon' | 'image' | 'file' | 'link' }
  | { type: 'number'; integer?: boolean; min?: number; max?: number }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'reference'; to: CollectionName; many?: boolean }
  | { type: 'object'; fields: Record<string, Field> }
  | { type: 'list'; of: Record<string, Field>; itemLabel: string; minItems?: number; maxItems?: number }
);
export interface Collection {
  name: CollectionName; kind: 'collection' | 'singleton'; label: string; labelPlural: string;
  icon: string; titleField: string; orderable?: boolean; fields: Record<string, Field>;
  preview?: { page: PageName; anchor?: string | ((doc: Record<string, unknown>) => string) };
  trashable: boolean; systemManaged?: boolean;
}
const text = (options: FieldOptions & { maxLength?: number; multiline?: boolean; placeholder?: string } = {}): Field => ({ type: 'text', ...options });
const rich = (inline = false, required = false): Field => ({ type: 'richtext', inline, required, editable: 'inline' });
const select = (values: readonly string[], required = false): Field => ({ type: 'select', options: values.map(value => ({ value, label: value })), required });
const object = (fields: Record<string, Field>, options: FieldOptions = {}): Field => ({ type: 'object', fields, ...options });
const list = (of: Record<string, Field>, itemLabel = Object.keys(of)[0]): Field => ({ type: 'list', of, itemLabel });
const url: Field = { type: 'url', allowRelative: true, allowMailto: true };
const image: Field = { type: 'image' };
const link: Field = { type: 'link' };
const buttons = list({ label: text({ required: true }), href: { ...url, required: true }, external: { type: 'boolean' } }, 'label');
const strings = list({ text: text() });
const facts = list({ label: text(), value: text(), note: text() }, 'label');
const cards = list({ icon: { type: 'icon' }, title: text(), text: text() }, 'title');
const section = (fields: Record<string, Field> = {}): Field => object({ eyebrow: text(), title: rich(true), ...fields });
const refs = (to: CollectionName, many = true, required = false): Field => ({ type: 'reference', to, many, required });
const meta = object({ title: text(), description: text({ multiline: true }), ogImage: image });
const hero = section({ image, lead: text({ multiline: true, editable: 'inline' }), chips: strings });
const subnav = list({ label: text(), anchor: text() }, 'label');
const actionBar = object({ buttons });
const cta = section({ text: text(), buttons });
function singleton(name: CollectionName, label: string, fields: Record<string, Field>, titleField = 'meta.title'): Collection {
  return { name, label, labelPlural: label, kind: 'singleton', icon: 'book', titleField, trashable: false, fields,
    ...(name !== 'site' ? { preview: { page: (name === 'sponsorsPage' ? 'sponsors' : name) as PageName } } : {}) };
}
function collection(name: CollectionName, label: string, labelPlural: string, titleField: string, fields: Record<string, Field>, page?: PageName, orderable = true): Collection {
  return { name, label, labelPlural, titleField, fields, kind: 'collection', icon: 'book', trashable: true, orderable, ...(page ? { preview: { page } } : {}) };
}
export const collections: Record<CollectionName, Collection> = {
  site: singleton('site', 'Site settings', {
    name: text(), shortName: text(), tagline: text(), areasServed: strings,
    contact: object({ name: text(), role: text(), email: { type: 'email' } }),
    socials: object({ facebook: url, instagram: url, tiktok: url }),
    links: object({ spareTheAir: url, privacyPolicy: url }), copyright: text(),
    utilityBar: object({ enabled: { type: 'boolean' }, pillText: text(), message: text(), messageLong: text() }),
    banner: object({ enabled: { type: 'boolean', default: false }, text: text(), link, style: select(['gold', 'soft-gold', 'green', 'dark']) }),
    nav: list({ label: text(), page: select(pageNames), href: url, visible: { type: 'boolean', default: true } }, 'label'),
    headerCta: link, footer: object({ blurb: text(), columns: list({ heading: text(), links: buttons }, 'heading') }),
    seo: object({ indexable: { type: 'boolean', default: false }, defaultOgImage: image }),
    events: object({ hidePastAfterDays: { type: 'number', integer: true, min: 0, default: 60 } }),
  }, 'name'),
  home: singleton('home', 'Home', {
    meta, hero: section({ lead: text({ multiline: true, editable: 'inline' }), primaryCta: link, secondaryCta: link, pills: strings, image }),
    season: object({ title: text(), marks: list({ label: text(), position: { type: 'percent' } }, 'label'),
      bands: list({ kind: select(['rec', 'comp']), from: { type: 'percent' }, to: { type: 'percent' } }, 'kind'),
      phases: list({ fromMonth: { type: 'month' }, toMonth: { type: 'month' }, label: text() }, 'label'),
      legend: list({ swatch: text(), label: text() }, 'label'), srSummary: text() }),
    calloutsSection: section(), programsSection: section({ lead: text() }),
    programs: list({ kicker: text(), title: rich(true), text: text(), badge: text(), image, facts, cta: link, secondaryLink: link }, 'title'),
    band: section({ lead: text(), image, stats: list({ value: text(), label: text() }, 'label') }),
    resultsSection: section({ lead: text(), link, resultIds: refs('results') }),
    explore: section({ tiles: list({ kicker: text(), title: text(), text: text(), image, href: url }, 'title') }),
    sponsorsSection: section({ lead: text(), link }), cta,
    eventsSection: section({ lead: text(), newsLink: link }),
  }),
  recreational: singleton('recreational', 'Recreational', {
    meta, hero, subnav, overview: section({ lead: text(), body: rich() }), season: section({ cards }),
    fees: section({ lead: text(), windows: list({ ages: text(), grades: text(), price: { type: 'money' }, window: text(), latePrice: { type: 'money' }, lateLabel: text(), featured: { type: 'boolean' } }, 'ages'), note: text() }),
    register: section({ note: rich(), buttons }), glance: object({ title: text(), facts, buttons, note: text() }),
    equipment: section({ image, items: cards, ballSizes: list({ size: { type: 'number', integer: true, min: 1 }, ages: text() }, 'ages') }),
    coaching: section({ lead: text(), documentIds: refs('documents') }), policies: section({ lead: text(), documentIds: refs('documents') }), actionBar,
  }),
  competitive: singleton('competitive', 'Competitive', {
    meta, hero, subnav, overview: section({ cards, columns: list({ title: text(), bullets: strings }, 'title') }),
    resultsSection: section({ resultIds: refs('results') }), teamsSection: section({ lead: text(), seasonLabel: text() }),
    costs: section({ total: object({ label: text(), note: text() }), items: list({ label: text(), price: { type: 'money' }, note: text(), color: text() }, 'label'), estimateNote: text(), documentIds: refs('documents') }),
    coaches: section({ image, benefitsTitle: text(), benefits: strings, newTitle: text(), newItems: strings, applyCard: object({ title: text(), body: rich(), buttons }) }),
    faqSection: section(), actionBar,
  }),
  referees: singleton('referees', 'Referees', { meta, hero, program: section({ body: rich() }), why: section({ cards }), contact: section({ boardMemberId: refs('boardMembers', false), buttonLabel: text(), documentIds: refs('documents') }), cta }),
  sponsorsPage: singleton('sponsorsPage', 'Sponsors', { meta, hero, goldSection: section(), teamSection: section(), tiersSection: section(), how: section({ steps: list({ title: text(), text: text() }, 'title'), buttons }), scholarship: section({ card: object({ title: text(), text: text(), button: link }) }) }),
  board: singleton('board', 'Board', { meta, hero, members: section(), meetings: section({ note: rich(), agmCard: object({ title: text(), text: text() }) }) }),
  resources: singleton('resources', 'Resources', { meta, hero, library: section({ lead: text(), searchPlaceholder: text(), categories: list({ key: text(), label: text() }, 'label'), emptyText: text() }), formsNote: rich() }),
  about: singleton('about', 'About', { meta, hero, purpose: section({ lead: text(), statement: rich() }), vision: section({ image, heading: text(), lead: text(), body: text({ multiline: true }) }), mission: section({ image, heading: text(), bullets: strings }), values: section({ items: list({ title: text(), text: text() }, 'title') }), cta }),
  events: collection('events', 'Event', 'Events', 'title', {
    title: text({ required: true }), type: select(['Fundraiser', 'All-stars', 'Club meeting', 'Annual meeting', 'Game', 'Tournament', 'Other']),
    date: { type: 'date', required: true }, time: { type: 'time' }, endTime: { type: 'time' }, location: text(), locationDetail: text(), calendarTitle: text(), link: url, notes: rich(), showOnHome: { type: 'boolean', default: true },
  }, 'home', false),
  callouts: collection('callouts', 'Callout', 'Callouts', 'title', { pillText: text(), pillStyle: select(['gold', 'soft-gold', 'green', 'dark']), title: text({ required: true }), text: text(), href: { ...url, required: true }, external: { type: 'boolean' }, icon: { type: 'icon' }, active: { type: 'boolean', default: true }, startsAt: { type: 'datetime' }, endsAt: { type: 'datetime' } }, 'home'),
  teams: collection('teams', 'Team', 'Teams', 'name', { ageGroup: select(Array.from({ length: 14 }, (_, i) => `U${i + 6}`), true), gender: select(['girls', 'boys', 'coed'], true), level: select(['Gold', 'Silver', 'Bronze', 'Copper'], true), name: text(), coaches: list({ name: text() }), season: text({ defaultFrom: 'competitive.teamsSection.seasonLabel' }) }, 'competitive'),
  results: collection('results', 'Result', 'Results', 'teamName', { competition: text({ required: true }), year: { type: 'number', integer: true, min: 1, max: 9999 }, teamName: text({ required: true }), ageGroup: text(), gender: select(['girls', 'boys', 'coed']), place: { type: 'number', integer: true, min: 1, max: 8, required: true }, note: text() }, 'competitive'),
  boardMembers: collection('boardMembers', 'Board member', 'Board members', 'role', { role: text({ required: true }), name: text(), email: { type: 'email', required: true }, vacantLabel: text({ default: 'Open position' }), note: text(), isPresident: { type: 'boolean' }, volunteerLink: { type: 'boolean' } }, 'board'),
  sponsors: collection('sponsors', 'Sponsor', 'Sponsors', 'name', { name: text({ required: true }), tier: refs('sponsorTiers', false, true), url, logo: image, active: { type: 'boolean', default: true } }, 'sponsors'),
  sponsorTiers: collection('sponsorTiers', 'Sponsor tier', 'Sponsor tiers', 'name', { name: text({ required: true }), program: select(['rec', 'comp']), price: { type: 'money' }, benefits: strings, featured: { type: 'boolean' }, showOnSponsorsPage: { type: 'boolean' } }, 'sponsors'),
  documents: collection('documents', 'Document', 'Documents', 'title', {
    title: text({ required: true }), description: text(), category: select(['club', 'safety', 'coaching', 'forms', 'policies'], true), kind: select(['pdf', 'form', 'link']),
    showInLibrary: { type: 'boolean', default: true },
    source: object({ mode: select(['url', 'upload'], true), url, fileId: { type: 'file' } }, { required: true }), external: { type: 'boolean' },
  }, 'resources'),
  faqs: collection('faqs', 'FAQ', 'FAQs', 'question', { page: select(['competitive', 'recreational', 'referees', 'sponsors'], true), question: text({ required: true }), answer: rich(false, true) }),
  media: { ...collection('media', 'Media item', 'Media', 'filename', { filename: text(), mime: text(), size: { type: 'number', integer: true, min: 0 }, width: { type: 'number', integer: true, min: 1 }, height: { type: 'number', integer: true, min: 1 }, alt: text(), caption: text(), focal: object({ x: { type: 'number', min: 0, max: 1 }, y: { type: 'number', min: 0, max: 1 } }), variants: object({ original: url, web: url }), source: select(['upload', 'static']), uploadedBy: text(), uploadedAt: { type: 'datetime' } }, undefined, false), systemManaged: true },
};
// Sponsors is both a page and a collection in the written plan. Keep the page at
// `sponsorsPage`, keeping the collection and public URL as `sponsors`.
