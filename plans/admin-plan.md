# Prospector Soccer Club — Admin / CMS implementation plan

Status: v1 for review · Author: lead architect (Fable) · Implementer: gpt-6.1-sol via Codex CLI, one phase per run · Reviewer: Fable

## 0. Summary of decisions

| Topic | Decision |
|---|---|
| Hosting | Vercel. Two serverless functions (`api/render.ts`, `api/admin.ts`), static assets + built admin SPA from `public/`. Stays under the Hobby-plan 12-function cap. |
| Rendering | Public pages are **server-rendered on request from a published content snapshot**, CDN-cached with `s-maxage` + `stale-while-revalidate` and tagged (`addCacheTag('content')`); publish calls `dangerouslyDeleteByTag('content')` from `@vercel/functions` (confirmed present in v3.11.0) so the next visitor gets a fresh render. Edits are live immediately when the purge succeeds and within ≤ ~30 s if it ever fails. No JS required for visitors; HTML output is byte-equivalent (after normalization) to today's static pages. |
| Storage | Small `Store` adapter interface. **Recommended: Neon Postgres (Vercel Marketplace) for documents/revisions/audit/users/sessions + Vercel Blob for media binaries.** Fallback: Blob-only (`KvStore` over Blob primitives). Local dev/tests: the same `KvStore` over the filesystem. |
| Content model | Typed schema in `shared/schema.ts` (singletons for site settings and each page; collections for events, callouts, teams, results, board members, sponsors, sponsor tiers, documents, FAQs, media). All current HTML content is migrated into seed JSON; templates render from it; golden tests prove nothing was lost. |
| Rich text | A **constrained Markdown subset** (paragraphs, bold, italic, links, line breaks, bullet lists) rendered by our own ~120-line renderer that escapes everything else. No HTML sanitizer needed. Editor = textarea + formatting toolbar + live preview. |
| Auth | Username + password, `crypto.scrypt` hashing, server-side sessions in the store, `HttpOnly; Secure; SameSite=Lax` cookie, double-submit CSRF token + Origin check, rate limiting and lockout, bootstrap Owner "Phil"/"Phil" from env, weak-password nudge (not forced). |
| Roles | Owner > Admin > Editor > Contributor > Viewer, enforced server-side by a single `can(user, action, target)` matrix. |
| History | Append-only revisions with full document data (sealed per editing session), publish records (site versions), audit log of every action. Restore any revision or any site version as a *new* revision/publish. Optimistic locking with a per-field merge UI on conflict. |
| Admin stack | **Vite + Preact + TypeScript + @preact/signals + preact-iso**, hand-written CSS reusing the site's design tokens. Server: **Hono** router on Vercel Node functions. Tests: Vitest + Playwright. Total runtime deps: 7. |

---

## 1. Architecture

```
                          ┌──────────────────────────── Vercel ─────────────────────────────┐
  Visitor ──GET /, /recreational …──▶ CDN cache (s-maxage, swr, ETag) ──miss──▶ api/render.ts │
                                          ▲  purge-by-tag on publish                 │        │
                                          │                                          ▼        │
  /assets/css, /assets/js, /assets/img ──▶ static files in public/            server/render/* │
  /admin/*  ──▶ static SPA (public/admin, built by Vite)                      (templates +    │
                                                                               richtext)      │
  Admin SPA ──fetch /api/admin/* (cookie + X-CSRF-Token)──▶ api/admin.ts (Hono)      │        │
                                                              │ auth · permissions · │        │
                                                              │ revisions · publish  │        │
                                                              ▼                      ▼        │
                                                        Store adapter  ◀────── read snapshot  │
                                                     ┌────────┴────────┐                      │
                                              PostgresStore        KvStore(primitives)        │
                                              (Neon, recommended)   ├─ BlobPrimitives (prod   │
                                                                    │   fallback)             │
                                                                    └─ FsPrimitives (dev/test)│
                                              MediaBlobs: @vercel/blob (prod) / FsBlobs (dev)  │
  Admin preview iframe ──GET /recreational?preview=1[&edit=1] (cookie)──▶ api/render.ts        │
                                                       (draft state, no-store, data-edit attrs)│
  └──────────────────────────────────────────────────────────────────────────────────────────┘
```

Request flow for a public page: CDN → `api/render.ts` → `store.getSnapshot()` (one read; cached in the function instance keyed by `siteVersion`) → template for the page → HTML with `ETag: W/"<siteVersion>-<buildHash>"`, `Cache-Control: public, s-maxage=15, stale-while-revalidate=300`, and the CDN tag `content` set via `addCacheTag`.

Request flow for an edit: SPA → `PUT /api/admin/docs/events/evt_x` with `baseVersion` → auth + CSRF + `can()` → validate against schema → CAS write of the draft → upsert working revision → audit → 200 `{doc}` (or 409 `{current}`). Publish: `POST /api/admin/publish` → copy draft→published for the selected docs, `siteVersion++`, regenerate snapshot, write publish record, seal revisions, audit, purge CDN tag (best effort) → 200 `{siteVersion}`.

## 2. Rendering model (and why)

Options considered:

1. **Server-render from content on request, CDN cache + SWR + purge (chosen).** Visitors get plain HTML (no JS needed, SEO-clean), edits are live within the cache window or instantly on purge, and the page templates are ordinary functions that the preview/inline-edit mode reuses with draft data. Cost: one small function read per cache miss; trivially cheap at this traffic.
2. Static build + client hydration: breaks "works without JS", puts content in a second request, hurts SEO and LCP. Rejected.
3. Rebuild via deploy hook on publish: 30–90 s latency per publish, consumes build minutes, publishes can queue/fail, and a rollback means another deploy. Rejected for "seconds, not a redeploy".

Cache policy details:

- `Cache-Control: public, s-maxage=15, stale-while-revalidate=300` (configurable via `CACHE_SMAXAGE`, `CACHE_SWR`). Browser `max-age=0` so visitors always revalidate with the CDN.
- The render handler calls `addCacheTag('content')` (from `@vercel/functions/cache`-style purge API; v3.11.0 exports `addCacheTag`, `invalidateByTag`, `dangerouslyDeleteByTag`). On publish the server calls `dangerouslyDeleteByTag('content')` inside try/catch and reports `purged: true|false` to the SPA. `dangerouslyDeleteByTag` (deadline 0) is preferred over `invalidateByTag` because the latter still serves one stale response while revalidating; at this traffic a cold render per publish is free. If the purge call throws (plan restriction, outage), the SWR window bounds staleness to ≤ `s-maxage` + one stale hit, and the SPA says "Live within about 30 seconds" instead of "Live now".
- Admin "View live" links append `?v=<siteVersion>` so editors always see the fresh render immediately (query string is part of the CDN cache key).
- If the snapshot contains scheduled items, `s-maxage` is capped at seconds-until-next-schedule so scheduled publishes go live on time with no cron dependency.
- `ETag` from `siteVersion` + template bundle hash; `If-None-Match` → 304.
- Preview (`?preview=1`) and edit (`?edit=1`) renders require a valid session; `Cache-Control: no-store`; render from drafts.

URLs: clean URLs become canonical (`/`, `/recreational`, …). `/:page.html` → 308 to `/:page`; `/index.html` → `/`. Templates emit clean internal links. `robots.txt` and `sitemap.xml` are rendered from site settings (`seo.indexable`, default `false` to preserve today's `noindex` until the club adopts the site).

Date-dependent behaviour (dimming past events, "today" marker on the season dial) stays client-side in `main.js` exactly as today, so cached HTML never shows a wrong "today". The renderer additionally omits events older than `site.events.hidePastAfterDays` (default 60) so the list cannot grow unbounded.

## 3. Content schema

All schema lives in `shared/schema.ts` and drives: server validation, the generic admin form engine, diff labelling, search indexing, and health checks. Every list item carries a stable `_key` (random 8 chars) so diffs and drag-reorder are id-based.

### 3.1 Field types

```ts
type Field =
  | { type: 'text'; required?: boolean; maxLength?: number; multiline?: boolean; placeholder?: string }
  | { type: 'richtext'; required?: boolean; inline?: boolean }   // constrained markdown; inline = no block elements (titles with <em>/<br>)
  | { type: 'url'; required?: boolean; allowMailto?: boolean; allowRelative?: boolean }
  | { type: 'email'; required?: boolean }
  | { type: 'date' }            // 'YYYY-MM-DD'
  | { type: 'time' }            // 'HH:MM' 24h, America/Los_Angeles
  | { type: 'datetime' }        // ISO string, used for scheduling and callout windows
  | { type: 'number'; integer?: boolean; min?: number; max?: number }
  | { type: 'money' }           // { amount: number; max?: number } → "$170" or "$100–$150"
  | { type: 'percent' }         // 0–100, season dial positions
  | { type: 'month' }           // 1–12
  | { type: 'boolean' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'icon' }            // one of the inline SVG icon names in server/render/icons.ts
  | { type: 'image'; required?: boolean }     // { mediaId: string; alt: string }
  | { type: 'file' }                           // { mediaId: string }
  | { type: 'reference'; to: CollectionName; many?: boolean }   // ids; ordered when many
  | { type: 'link' }            // { label: string; href: string; external?: boolean } — CTA buttons/links
  | { type: 'object'; fields: Record<string, Field>; label?: string }
  | { type: 'list'; of: Record<string, Field>; itemLabel: string /* field name used as row title */; minItems?: number; maxItems?: number }
```

Common field options: `label`, `help`, `group` (collapsible section name in the form), `width: 'half'|'full'`, `editable: 'inline'` (eligible for click-to-edit on the live page).

### 3.2 Collection/singleton definitions

```ts
interface Collection {
  name: CollectionName; kind: 'collection' | 'singleton';
  label: string; labelPlural: string; icon: string;
  titleField: string;                 // used in lists, history, audit, search
  orderable?: boolean;                // drag-to-reorder → `order` number
  fields: Record<string, Field>;
  preview?: { page: PageName; anchor?: string | ((doc) => string) };   // which public page shows it
  trashable: boolean;                 // singletons: false
}
```

Singletons:

| Name | Purpose | Fields (abridged; full list in Phase 1) |
|---|---|---|
| `site` | Global settings | `name`, `shortName`, `tagline`, `areasServed[]`, `contact { name, role, email }`, `socials { facebook, instagram, tiktok }` (url), `links { spareTheAir, privacyPolicy }`, `copyright` (text), `utilityBar { enabled, pillText, message, messageLong }`, `banner { enabled, text, link, style }` (site-wide announcement bar, new), `nav[] { label, page|href, visible }`, `headerCta` (link), `footer { blurb, columns[] { heading, links[] } }`, `seo { indexable, defaultOgImage }`, `events { hidePastAfterDays }` |
| `home` | Home page | `meta { title, description, ogImage }`, `hero { eyebrow, title (richtext inline), lead, primaryCta, secondaryCta, pills[] { text }, image }`, `season { title, marks[] { label, position(percent) }, bands[] { kind: rec|comp, from, to (percent) }, phases[] { fromMonth, toMonth, label }, legend[] { swatch, label }, srSummary }`, `calloutsSection { eyebrow?, title }` (+ `callouts` collection), `programsSection { eyebrow, title, lead }`, `programs[] { kicker, title, text, badge, image, facts[] { label, value, note }, cta (link), secondaryLink (link) }`, `band { eyebrow, title (richtext inline), lead, image, stats[] { value, label } }`, `resultsSection { eyebrow, title, lead, link, resultIds (reference many → results) }`, `explore { eyebrow, title, tiles[] { kicker, title, text, image, href } }`, `sponsorsSection { eyebrow, title, lead, link }`, `cta { eyebrow, title, text, buttons[] (link) }`, `eventsSection { eyebrow, title, lead, newsLink }` |
| `recreational` | Rec page | `meta`, `hero { image, eyebrow, title, lead, chips[] }`, `subnav[] { label, anchor }`, `overview { eyebrow, title, lead, body (richtext) }`, `season { eyebrow, title, cards[] { icon, title, text } }`, `fees { eyebrow, title, lead, windows[] { ages, grades, price (money), window, latePrice (money), lateLabel, featured } , note }`, `register { eyebrow, title, note (richtext), buttons[] }`, `glance { title, facts[] { label, value }, buttons[], note }`, `equipment { eyebrow, title, image, items[] { icon, title, text }, ballSizes[] { size, ages } }`, `coaching { eyebrow, title, lead, documentIds (reference many → documents) }`, `policies { eyebrow, title, lead, documentIds }`, `actionBar { buttons[] }` |
| `competitive` | Comp page | `meta`, `hero`, `subnav[]`, `overview { eyebrow, title, cards[] { icon, title, text }, columns[] { title, bullets[] { text } } }`, `resultsSection { eyebrow, title, resultIds }`, `teamsSection { eyebrow, title, lead, seasonLabel }` (+ `teams` collection), `costs { eyebrow, title, total { label, note }, items[] { label, price (money), note, color }, estimateNote, documentIds }`, `coaches { eyebrow, title, image, benefitsTitle, benefits[] { text }, newTitle, newItems[] { text }, applyCard { title, body (richtext), buttons[] } }`, `faqSection { eyebrow, title }` (+ `faqs` where `page=competitive`), `actionBar` |
| `referees` | Referees page | `meta`, `hero`, `program { eyebrow, title, body (richtext) }`, `why { eyebrow, title, cards[] }`, `contact { eyebrow, title, boardMemberId (reference → boardMembers), buttonLabel, documentIds }`, `cta { eyebrow, title, text, buttons[] }` |
| `sponsors` | Sponsors page | `meta`, `hero`, `goldSection { eyebrow, title }`, `teamSection { eyebrow, title }`, `tiersSection { eyebrow, title }`, `how { eyebrow, title, steps[] { title, text }, buttons[] }`, `scholarship { eyebrow, title, card { title, text, button } }` |
| `board` | Board page | `meta`, `hero`, `members { eyebrow, title }`, `meetings { eyebrow, title, note (richtext), agmCard { title, text } }` |
| `resources` | Resources page | `meta`, `hero`, `library { eyebrow, title, lead, searchPlaceholder, categories[] { key, label }, emptyText }`, `formsNote (richtext)` |
| `about` | About page | `meta`, `hero`, `purpose { eyebrow, title, lead, statement (richtext) }`, `vision { eyebrow, title, image, heading, lead, body }`, `mission { eyebrow, title, image, heading, bullets[] }`, `values { eyebrow, title, items[] { title, text } }`, `cta` |

Collections:

| Name | Fields | Notes |
|---|---|---|
| `events` | `title*`, `type` (select: Fundraiser, All-stars, Club meeting, Annual meeting, Game, Tournament, Other), `date*`, `time`, `endTime`, `location`, `locationDetail`, `calendarTitle`, `link` (url), `notes` (richtext), `showOnHome` (bool, default true) | sorted by date; home shows upcoming; "Recently passed" handled client-side as today |
| `callouts` | `pillText`, `pillStyle` (select: gold, soft-gold, green, dark), `title*`, `text`, `href*` (url), `external` (bool), `icon`, `active` (bool), `startsAt`, `endsAt` (datetime) | orderable; renderer skips inactive/out-of-window |
| `teams` | `ageGroup*` (select U6…U19), `gender*` (girls/boys/coed), `level*` (select Gold/Silver/Bronze/Copper), `name`, `coaches[] { name }`, `season` (text, default from `competitive.teamsSection.seasonLabel`) | orderable; health check counts vs home stat |
| `results` | `competition*` (e.g. "2026 CUFA Tournament"), `year`, `teamName*`, `ageGroup`, `gender`, `place*` (number 1–8), `note` | orderable; home/comp pick via `resultIds` |
| `boardMembers` | `role*`, `name` (empty = vacant), `email*`, `vacantLabel` (default "Open position"), `note`, `isPresident` (bool), `volunteerLink` (bool) | orderable; initials derived |
| `sponsors` | `name*`, `tier*` (reference → sponsorTiers), `url` (url), `logo` (image), `active` (bool) | orderable; displayed domain derived from url |
| `sponsorTiers` | `name*`, `program` (select rec/comp), `price` (money), `benefits[] { text }`, `featured` (bool → gold styling), `showOnSponsorsPage` (bool) | orderable |
| `documents` | `title*`, `description`, `category*` (select: club, safety, coaching, forms, policies), `kind` (select: pdf, form, link; drives the icon), `source*` = object `{ mode: 'url'|'upload', url, fileId (file) }`, `external` (bool) | orderable within category; referenced from pages via `documentIds` |
| `faqs` | `page*` (select: competitive, recreational, referees, sponsors), `question*`, `answer*` (richtext) | orderable |
| `media` | system-managed: `filename`, `mime`, `size`, `width`, `height`, `alt` (default alt), `caption`, `focal { x, y }` (0–1), `variants { original: url, web: url }`, `source: 'upload'|'static'`, `uploadedBy`, `uploadedAt` | existing `/assets/img/*` are registered as `static` media at migration |

System collections (not editable as content): `users`, `sessions`, `revisions`, `publishes`, `audit`, `loginAttempts`, `scheduled`, `linkChecks`, `snapshots`.

### 3.3 Document envelope

```ts
interface Doc<T = unknown> {
  id: string;                 // `${prefix}_${random}` e.g. evt_8f2k1q; singletons use their name
  collection: CollectionName;
  draft: T;                   // current working data
  published?: T;              // last published data
  version: number;            // increments on every draft write (optimistic lock)
  publishedVersion?: number;  // draft version that was last published
  order?: number;
  status: 'draft' | 'published' | 'changed' | 'scheduled' | 'review' | 'trashed';   // derived except review/trashed
  reviewRequestedBy?: string; reviewNote?: string;
  scheduledAt?: string;       // ISO; present while a scheduled publish is pending
  trashedAt?: string; trashedBy?: string;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}
```

## 4. Storage

### 4.1 Adapter interface (`server/store/types.ts`)

```ts
export interface Store {
  // documents
  getDoc(collection, id): Promise<Doc | null>;
  listDocs(collection, opts?: { includeTrashed?: boolean }): Promise<Doc[]>;
  createDoc(doc: Doc): Promise<Doc>;                                  // fails if id exists
  updateDoc(collection, id, expectedVersion: number, patch: Partial<Doc>): Promise<Doc | 'conflict'>;  // CAS on version; sets version = expected+1
  // snapshot & publishing
  getSnapshot(): Promise<Snapshot | null>;                             // { siteVersion, publishedAt, docs: Record<collection, PublishedDoc[]>, scheduled: ScheduledItem[], templateHash }
  publish(tx: PublishTx): Promise<{ siteVersion: number }>;           // atomic where possible: write published copies, write snapshot, append publish record, bump siteVersion
  listPublishes(limit, before?): Promise<PublishRecord[]>; getPublish(siteVersion): Promise<PublishRecord | null>;
  // revisions (append-only; `upsertWorkingRevision` may overwrite ONLY an unsealed revision)
  appendRevision(rev: Revision): Promise<void>;
  upsertWorkingRevision(rev: Revision): Promise<void>;
  sealRevision(revId): Promise<void>;
  listRevisions(collection, id, limit, before?): Promise<Revision[]>; getRevision(revId): Promise<Revision | null>;
  // audit
  appendAudit(entry: AuditEntry): Promise<void>;
  queryAudit(q: { actorId?, action?, collection?, docId?, from?, to?, text?, limit, cursor? }): Promise<{ items: AuditEntry[]; cursor?: string }>;
  // users & sessions
  listUsers(): Promise<User[]>; getUser(id): Promise<User | null>; getUserByUsername(u): Promise<User | null>;
  putUser(user: User): Promise<void>;
  getSession(hash): Promise<Session | null>; putSession(s: Session): Promise<void>; deleteSession(hash): Promise<void>; listSessions(userId): Promise<Session[]>;
  // rate limiting
  rateLimitHit(key, windowSec): Promise<{ count: number; resetAt: string }>; rateLimitReset(key): Promise<void>;
  // misc small state
  getMeta(key): Promise<unknown>; setMeta(key, value): Promise<void>;   // link check results, settle cursors, bootstrap flag
  // media metadata lives in `media` docs via getDoc/listDocs
}

export interface MediaBlobs {
  put(path, body: Uint8Array | ReadableStream, opts: { contentType }): Promise<{ url: string }>;
  delete(url): Promise<void>;
}
```

Selection: `createStore()` in `server/store/index.ts` reads `STORE_DRIVER` (`fs` | `blob` | `postgres`). `fs` and `blob` share `KvStore`, which implements the interface over four primitives `{ get(key), put(key, value), list(prefix), delete(key) }`. `postgres` is a native implementation.

### 4.2 Data layout

Postgres (recommended):

```sql
docs(id text pk, collection text, draft jsonb, published jsonb, version int, published_version int, "order" int,
     review_requested_by text, review_note text, scheduled_at timestamptz, trashed_at timestamptz, trashed_by text,
     created_at, created_by, updated_at, updated_by);                      -- index (collection, "order")
revisions(id text pk, collection text, doc_id text, doc_version int, author_id text, author_name text, at timestamptz,
     sealed_at timestamptz, action text, summary text, data jsonb, base_rev_id text, publish_site_version int); -- index (doc_id, at desc)
publishes(site_version int pk, at timestamptz, actor_id text, summary text, manifest jsonb /* [{collection,id,version,title}] */, kind text /* publish|restore|schedule */);
snapshots(id text pk /* 'published' */, site_version int, body jsonb, updated_at timestamptz);
audit(id text pk, at timestamptz, actor_id text, actor_name text, action text, collection text, doc_id text, target_title text, meta jsonb, ip text, user_agent text); -- index (at desc), (actor_id, at), (action, at)
users(id text pk, username text unique, display_name text, email text, role text, password_hash text, active bool, created_at, created_by, last_login_at, password_changed_at, must_change_password bool);
sessions(hash text pk, user_id text, created_at, last_seen_at, expires_at, ip text, user_agent text, csrf_token text);
rate_limits(key text pk, count int, window_start timestamptz);
meta(key text pk, value jsonb);
```

KV layout (Blob fallback and FS dev; one JSON per key):

```
docs/<collection>/<id>.json         revisions/<docId>/<at>-<revId>.json      publishes/<siteVersion padded 8>.json
snapshot/published.json             audit/<yyyy-mm>/<at>-<id>.json           users/<id>.json  users-by-name/<username>.json
sessions/<hash>.json                ratelimit/<key>.json                      meta/<key>.json
```

Blob is write-after-read (no CAS), so `KvStore` implements `updateDoc` as read→compare→write, which leaves a small race window. Acceptable for a handful of editors; documented in the admin "About" panel. `PostgresStore` uses `UPDATE … WHERE version = $expected` and a transaction for `publish`. Both must pass the shared contract test suite (`tests/store-contract.test.ts`), run against FS always and against Postgres/Blob when `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` are present.

Media binaries: `@vercel/blob` with public access, path `media/<yyyy>/<mediaId>/<web|original>.<ext>` (unguessable id; `addRandomSuffix: false`). Dev: `FsBlobs` writes under `DATA_DIR/blobs` and the dev server serves them at `/blobs/*`.

## 5. API

Base `/api/admin`. JSON in/out. Errors: `{ error: { code, message, details? } }` with codes `unauthenticated` (401), `forbidden` (403), `not_found` (404), `validation` (422, `details: [{ path, message }]`), `conflict` (409, `details: { current: Doc }`), `rate_limited` (429, `Retry-After`), `locked` (423). All state-changing requests require: session cookie, `X-CSRF-Token` header matching the session's token, and `Origin`/`Sec-Fetch-Site` consistent with `PUBLIC_BASE_URL`.

| Method & path | Permission | Notes |
|---|---|---|
| `POST /auth/login` `{username,password}` | public | rate-limited; sets cookie; returns `{ user, csrfToken, passwordWeak }` |
| `POST /auth/logout` | session | deletes session |
| `GET /auth/me` | session | `{ user, csrfToken, passwordWeak, permissions: string[] }` |
| `POST /auth/password` `{current,next}` | session | policy check; rotates session; audit |
| `GET /auth/sessions`, `DELETE /auth/sessions/:hash`, `POST /auth/sessions/revoke-others` | session | |
| `GET /docs/:collection` | `content.read` | includes trashed only with `?trashed=1` |
| `GET /docs/:collection/:id` | `content.read` | |
| `POST /docs/:collection` | `content.create` | validates; creates draft; revision `created` |
| `PUT /docs/:collection/:id` `{ baseVersion, draft, summary?, checkpoint? }` | `content.edit` | CAS → 409 with `current`; working revision upsert; `checkpoint:true` seals with `summary` |
| `POST /docs/:collection/reorder` `{ ids: string[] }` | `content.edit` | one audit entry; revision per moved doc is NOT created (order is doc metadata; audit suffices) |
| `POST /docs/:collection/:id/trash`, `POST …/untrash` | `content.trash` | soft delete; untrash restores |
| `POST /docs/:collection/:id/duplicate` | `content.create` | |
| `POST /docs/:collection/:id/review` `{ note }` / `DELETE …/review` | `content.edit` | Contributor requests review |
| `POST /publish` `{ items?: [{collection,id}], all?: true, summary? }` | `content.publish` | see §7; returns `{ siteVersion, purged: boolean }` |
| `POST /unpublish` `{ items }` | `content.publish` | removes from snapshot; doc keeps draft |
| `POST /schedule` `{ items, at }` / `DELETE /schedule/:collection/:id` | `content.publish` | |
| `GET /pending` | `content.read` | docs whose draft differs from published, with field-diff summaries |
| `GET /revisions/:collection/:id` | `history.read` | paged |
| `GET /revisions/:revId` | `history.read` | includes `diff` vs previous revision |
| `POST /revisions/:revId/restore` `{ publish?: boolean }` | `content.edit` (+`content.publish` if `publish`) | draft ← rev.data as new revision `restored` |
| `GET /publishes`, `GET /publishes/:siteVersion` | `history.read` | manifests; `?diff=1` compares with current |
| `POST /publishes/:siteVersion/restore` `{ summary }` | `site.restore` | whole-site restore (§7.4) |
| `GET /audit` (filters: `actor, action, collection, docId, from, to, q, cursor`) | `audit.read` | |
| `GET /audit/export?format=csv|json&…filters` | `audit.export` | streams |
| `GET /media`, `GET /media/:id` | `content.read` | `?unused=1`, `?missingAlt=1` |
| `POST /media/upload-url` `{ filename, mime, size }` | `media.upload` | returns client-upload token (`@vercel/blob` `handleUpload` flow); dev returns a direct PUT URL on the dev server |
| `POST /media` `{ blob urls, width, height, alt, … }` | `media.upload` | finalizes record after client upload |
| `PATCH /media/:id` `{ alt, caption, focal }` | `media.edit` | |
| `DELETE /media/:id` | `media.delete` | refused (409) if referenced; moves to trash otherwise |
| `GET /media/:id/usage` | `content.read` | docs referencing it |
| `GET /users`, `POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `POST /users/:id/revoke-sessions`, `DELETE /users/:id` (deactivate) | `users.manage` (role ceiling rules in §6.3) | |
| `GET /dashboard` | `content.read` | pending count, health checks, recent activity, scheduled |
| `POST /health/links` | `content.publish` | runs link check (timeout 8 s, concurrency 5), stores result in meta |
| `GET /search?q=` | `content.read` | title/body match across collections, max 20 |
| `GET /export/content` | `site.export` | zip-less JSON of all drafts + published (backup) |
| `POST /cron/settle` | `CRON_SECRET` header | settles passed scheduled items into publish records (§7.5) |

Public function `api/render.ts`: `GET /?page=<name>[&preview=1][&edit=1][&v=…]`, plus `robots.txt`, `sitemap.xml`, 404 page. Never reads cookies unless `preview`/`edit` present (keeps the cache key clean).

## 6. Security model

### 6.1 Passwords and sessions

- `scrypt` via Node `crypto.scrypt` with `N=2^15, r=8, p=1, keylen=64`, 16-byte salt; stored as `scrypt$15$8$1$<salt b64>$<hash b64>`; `timingSafeEqual`. Unknown usernames still run a dummy verify (constant time).
- Policy for *new* passwords: ≥ 10 chars, not equal to username, not in a bundled 1k common-password list. Bootstrap password is exempt (it is "Phil" by requirement). `passwordWeak = length < 10 || equals username || in common list` is computed at login and surfaced as a persistent, dismissible-per-session banner with a one-click path to Profile → Change password. Not forced.
- Session id: 32 random bytes base64url; the store keeps `sha256(id)`. Cookie `psc_session`: `HttpOnly; Secure (prod); SameSite=Lax; Path=/`; idle expiry 14 days (sliding, refreshed at most hourly), absolute 30 days. Changing password or role revokes other sessions.
- Bootstrap: on first use (`npm run bootstrap` locally; lazily on the first admin API request in prod) if `users` is empty, create Owner `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` and write audit `system.bootstrap`. Never re-runs once a user exists, so later env values are inert.

### 6.2 CSRF, headers, limits

- Double-submit: session stores `csrfToken`; `/auth/me` and login return it; SPA sends `X-CSRF-Token` on every non-GET. Server also rejects non-GET when `Origin` is present and does not match `PUBLIC_BASE_URL` (or `Sec-Fetch-Site` is `cross-site`).
- Rate limits (store-backed): login 10/15 min per IP, 5 consecutive failures per username → lock 15 min, doubling per subsequent lockout to max 24 h; uploads 60/h per user; general admin API 600/5 min per session. Lockouts and failures are audited (`auth.login_failed`, `auth.locked`).
- Headers (`vercel.json` + handlers): `Content-Security-Policy` for `/admin/*`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; connect-src 'self' https://*.public.blob.vercel-storage.com; frame-src 'self'; frame-ancestors 'none'`. Public pages: `frame-ancestors 'self'` (preview iframe), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal.
- Uploads: allowlist by magic bytes (`jpeg, png, webp, gif, pdf`); SVG rejected (XSS vector); images ≤ 8 MB, PDFs ≤ 15 MB; filenames sanitized; `Content-Disposition: inline` only for the allowlisted types.
- Rich text: the constrained-Markdown renderer escapes all HTML; `href` must be `https:`, `http:`, `mailto:` or site-relative; `javascript:` and `data:` rejected at validation and at render.
- Template output: every interpolation passes through the `html` tagged template's escaper; raw insertion only via explicit `raw()` of renderer-produced strings (richtext output, icons).
- Preview/edit renders: require a session; `no-store`; the public cache key never includes them.
- Secrets live only in Vercel env; the repo stays public-safe. Audit entries store IP and user agent.

### 6.3 Roles and permissions (`server/permissions.ts`)

| Action | Viewer | Contributor | Editor | Admin | Owner |
|---|---|---|---|---|---|
| `content.read`, `history.read`, preview drafts | ✓ | ✓ | ✓ | ✓ | ✓ |
| `content.create`, `content.edit` (drafts), request review | | ✓ | ✓ | ✓ | ✓ |
| `media.upload`, `media.edit` (own uploads for Contributor) | | ✓ | ✓ | ✓ | ✓ |
| `content.publish`, `unpublish`, `schedule`, approve review, restore revision + publish | | | ✓ | ✓ | ✓ |
| `content.trash`, `media.delete`, link check, reorder | | | ✓ | ✓ | ✓ |
| `site.settings` (edit `site` singleton) | | | ✓ | ✓ | ✓ |
| `audit.read`, `audit.export`, `site.export` | | | | ✓ | ✓ |
| `users.manage` for roles ≤ Editor | | | | ✓ | ✓ |
| `users.manage` for Admin/Owner, `site.restore` (whole site), transfer ownership | | | | | ✓ |

Rules: a user cannot change their own role; the last active Owner cannot be demoted or deactivated; Admins cannot create/modify Admins or Owners; a Contributor's edit to an already-published doc only touches the draft (publish stays gated). `can()` is pure and table-driven; every Hono route declares its permission via `requirePermission('content.publish')` middleware, and the SPA mirrors the same table (from `/auth/me.permissions`) only to hide controls.

## 7. History, publishing and restore semantics

### 7.1 Revisions

- Every draft write produces or updates a **working revision** for `(docId, authorId)`: if the latest revision for the doc is unsealed, by the same author, and < 10 minutes old, it is updated in place (data, `at`, `docVersion`); otherwise a new revision is appended. A revision **seals** (becomes immutable forever) when: another user edits the doc, the doc is published, 10 minutes pass since its last update, the author clicks "Save checkpoint" (optional summary), the author signs out, or a restore happens. Sealed revisions are never modified or deleted.
- Revision record: `{ id, collection, docId, docVersion, authorId, authorName, at, sealedAt?, action: created|edited|checkpoint|published|unpublished|restored|trashed|untrashed|scheduled|site_restored, summary?, data /* full draft */, baseRevId? /* for restored */, publishSiteVersion? }`.
- Diffs are computed on read (`server/content/diff.ts`): schema-aware field diff (lists matched by `_key` → added/removed/moved/changed), word-level diff for text via the `diff` package. Cheap because docs are small; storing full data makes restore trivial and robust to schema additions.
- Client-side undo (⌘Z) is a per-field, in-session stack; server history is the durable record.

### 7.2 Publish

`POST /publish`: for each item (or all pending): `published ← draft`, `publishedVersion ← version`, clear `scheduledAt`/review flags; seal working revisions and append `published` revisions (summary = user note); write `publishes` record `{ siteVersion: n+1, manifest: every published doc's {collection,id,version,title}, actor, summary, kind }`; regenerate snapshot from all published docs (+ `scheduled[]`); write audit `content.publish` with item list; purge CDN tag. In Postgres this is one transaction; in KV it is sequenced and the snapshot write happens last (a crash before it leaves `published` fields updated but no new snapshot — the dashboard shows "snapshot behind, click to rebuild", which re-runs the snapshot step idempotently).

### 7.3 Optimistic locking and concurrency

- Every `PUT` carries `baseVersion`; CAS failure → 409 with the server's current doc. The SPA opens a merge panel: per changed field "Keep mine / Take theirs", shows who/when, then retries with the new base. Autosave suppresses the panel for fields the other user did not touch (auto-merge when the change sets are disjoint).
- The SPA polls `GET /docs/:c/:id` (`If-None-Match` on version) every 20 s while an editor is open to show "Also editing: Ashlee (2 min ago)" using `updatedBy/updatedAt`; no locks, no realtime infra.
- Publish of a doc with a newer draft than the one the user saw (`items[].expectedVersion`) → 409 so nobody publishes someone else's half-written change unknowingly.

### 7.4 Restore

- Restore a revision: `draft ← revision.data`, new revision `restored` (`baseRevId`), `version++`; optional `publish:true` chains §7.2. Nothing is deleted.
- Restore the whole site to `siteVersion V`: for every doc in `publishes[V].manifest`, load that revision data (`revisions` where `docId` and `docVersion` match; the manifest stores `revId` to make this O(1)), set `draft` and `published` to it, append `site_restored` revisions; docs created after V are unpublished (removed from the snapshot, drafts kept); new publish record `{ kind: 'restore', restoredFrom: V }`; audit `site.restore`. Still forward-only: the old state is reachable again by restoring the newer version.
- Trash is soft and reversible; a trashed doc is removed from the snapshot at the next publish (the Publish tray lists "Remove from site: X").

### 7.5 Scheduling

"Schedule publish at …" stores `scheduledAt` and writes the current draft into `snapshot.scheduled[]`. The renderer applies scheduled items whose time has passed; cache `s-maxage` is capped at the next due time. `POST /cron/settle` (daily cron on Hobby, hourly on Pro) and any Editor+ admin request lazily convert due items into real publish records so history reflects them. Cancelling a schedule removes it from `scheduled[]` and republishes the snapshot.

## 8. Admin UX and information architecture

Visual language: the site's tokens (`--blue-900/950` navy, `--gold-500`, `--cream`, Barlow Condensed display, Manrope body) in a light, calm admin: navy sidebar with gold active marker, cream canvas, white cards, 14px/16px body, large touch targets (≥ 44 px), focus rings in gold. Login: full-bleed navy with the rays motif and crest, single card, "Prospector Soccer Club · Admin". No emojis; use the existing inline SVG icon set style.

### 8.1 Screens

1. **Login** `/admin/login` — username, password (show/hide), caps-lock hint, inline errors, lockout countdown, "Back to site".
2. **Dashboard** `/admin` — "Good evening, Phil"; cards: Pending changes (count + "Review & publish"), Scheduled, Awaiting review; **Health checks** list (each with a fix link); Recent activity (last 15 audit entries); quick actions (New event, Edit home, Upload media); weak-password banner when applicable.
3. **Pages** `/admin/pages/:page` — section accordion form on the left, live preview on the right (device toggle: phone 390, iPad 820, desktop 1280; preview reloads on debounce with `?preview=1`, scrolls to and outlines the field being edited). Toolbar: status pill, "Saved · just now" (aria-live), Save checkpoint, Publish split-button (Publish now / Schedule / Request review), overflow (History, View live, Discard draft changes → restores published data into draft as a revision).
4. **Collections** `/admin/:collection` — list with search, filter chips (status, type/category), sort, drag handle + keyboard reorder (↑/↓ with Alt), bulk select → Publish / Trash / Untrash, status pills, row preview thumbnails for sponsors/media. Empty states with a primary action. Trash tab.
5. **Document editor** `/admin/:collection/:id` — generic schema-driven form (two-column on desktop, single on phone), inline validation, field help, image picker (opens Media drawer), reference pickers with search, list editor (drag, duplicate, collapse, `itemLabel` titles). Right rail: preview (where the item appears) + History tab (revision timeline with diffs and Restore).
6. **Publish tray** (global, from the top bar) — pending docs grouped by collection with diff summaries ("Events · Board meeting: time 18:00 → 18:30"), checkboxes, optional note, "Publish 3 changes". After publish: toast with "View live" (`?v=`).
7. **Inline edit mode** — "Edit on page" opens the preview full-width with `?edit=1`; eligible text fields get a dashed outline on hover; click → plain-text fields edit in place (`contenteditable="plaintext-only"`, Enter commits, Esc cancels); richtext/other fields open a side popover with the normal field control. Changes flow to the same draft autosave; the iframe posts `{type:'edit', collection, id, path}` to the parent via `postMessage` (origin-checked).
8. **Media library** `/admin/media` — grid, multi-file dropzone (client-side resize to ≤ 2000 px and WebP via canvas; original kept if ≤ 8 MB), filter (images/documents/unused/missing alt), details drawer: alt, caption, focal point picker (click on image → `object-position`), usage list, Replace file, Delete (blocked when in use).
9. **History** `/admin/history` — two tabs: *Site versions* (publishes with manifests, "Compare with current", "Restore site to this version" with a confirmation that lists what will change) and *All revisions* (filter by collection/author).
10. **Audit log** `/admin/audit` — filters (actor, action group, collection, date range, text), infinite scroll, row expands to JSON meta, Export CSV/JSON with current filters.
11. **Users** `/admin/users` — list (role, last login, status), Add user (name, username, role; temp password generated and shown once with copy), edit role, deactivate, Reset password, Sign out everywhere. Role ceiling enforced server-side and reflected in UI.
12. **Settings** `/admin/settings` — the `site` singleton: contact & socials, announcement banner, utility bar, navigation (drag), header CTA, footer columns, SEO (indexable), events auto-hide; Danger zone → link to Site versions.
13. **Profile** `/admin/profile` — display name, change password (strength meter + policy), active sessions.

### 8.2 Cross-cutting interactions

- Autosave: 1.5 s debounce after last change, on blur, and on route change; retries with backoff; status text "Saving… / Saved · 12:04 / Offline — changes kept locally" (unsaved drafts mirrored to `localStorage` and offered for recovery).
- Unsaved-change guard: `beforeunload` + router guard when a save is in flight or failed.
- Undo/redo per field (⌘Z/⇧⌘Z) within the editor session; toasts with Undo for Trash, Reorder, Unpublish.
- Command palette ⌘K: navigate screens, "New event", "Publish all", "Open preview as iPad", search documents by title, jump to settings sections.
- Keyboard: ⌘S checkpoint, ⇧⌘P open Publish tray, `?` shortcut sheet, `[`/`]` prev/next item in a collection, Esc closes drawers.
- Validation: field-level on blur and on save; publish blocked with a list of errors that deep-links to fields.
- Responsive: ≤ 760 px sidebar becomes a bottom tab bar (Dashboard, Content, Media, More) and the editor stacks (form first, preview in a sheet). Everything usable on an iPhone and iPad.
- Accessibility: landmarks, labelled controls, focus trapping in drawers, `aria-live` for save state and toasts, visible focus, no colour-only status, reduced-motion respected, 4.5:1 contrast.

### 8.3 Admin entry on the public site

Utility bar (`src/layout` → `server/render/templates/layout.ts`): add `<a class="utility-bar__admin" href="/admin">` with a small key icon and the text "Admin" on the right, before the social icons; visible at all widths (socials already hide ≤ 560 px). `main.js` enhancement: when `localStorage.psc_admin === '1'` (set by the SPA on login, cleared on logout) the link reads "Edit this page" and deep-links to `/admin/pages/<page>`. No server-side session detection on cached public pages.

## 9. Front-end stack justification

Vite + Preact + TypeScript (+ `@preact/signals`, `preact-iso`): React mental model that Codex writes reliably, 4 KB runtime, TS types shared with the server (`shared/`), fast HMR, trivial Vercel build. Signals make autosave/dirty tracking and the live-preview wiring simple. No component library: hand-written CSS using the site tokens gives a consistent look at a fraction of the surface area. Rejected: vanilla web components (too much hand-rolled state for forms/diffs/drag), Preact/htm without a build (no TS, awkward testing), Vite + React (bigger with no benefit here). Routing with `preact-iso` (tiny, official). Drag-and-drop via native pointer events with keyboard fallback (no library). Word diff via `diff`. Server router via Hono (zero-dep, typed, works on Vercel Node functions).

## 10. Repository layout

```
package.json  tsconfig.json  vercel.json  vitest.config.ts  playwright.config.ts  .env.example  .gitignore
api/
  render.ts                 # Vercel function: public pages, robots, sitemap (thin: imports server/render/handler)
  admin.ts                  # Vercel function: Hono app for /api/admin/* (thin)
server/
  config.ts                 # env parsing with defaults and validation
  http/{hono-app.ts, middleware/(auth,csrf,permission,ratelimit,errors).ts, routes/*.ts}
  render/{handler.ts, html.ts (tagged template + escape + raw), richtext.ts, icons.ts, links.ts,
          templates/(layout, home, recreational, competitive, referees, sponsors, board, resources, about, notfound).ts,
          editable.ts (data-edit annotations), snapshot-view.ts (select published vs draft vs scheduled)}
  content/{validate.ts, ids.ts, revisions.ts, publish.ts, restore.ts, diff.ts, schedule.ts, health.ts, search.ts}
  auth/{password.ts, session.ts, csrf.ts, ratelimit.ts, bootstrap.ts}
  permissions.ts  audit.ts  media.ts
  store/{types.ts, index.ts, kv-store.ts, primitives/(fs,blob).ts, postgres-store.ts, postgres-schema.sql, blobs/(fs,vercel).ts}
shared/{schema.ts, types.ts, permissions-table.ts, richtext-grammar.ts}
admin/                      # Vite root (base /admin/)
  index.html  vite.config.ts
  src/{main.tsx, app.tsx, api.ts, auth.ts, router.tsx,
       state/(session,docs,autosave,toasts,palette).ts,
       components/(Shell, Sidebar, TopBar, Form/*, Fields/*, ListEditor, DragList, Preview, DiffView, Timeline,
                   PublishTray, MediaPicker, FocalPoint, CommandPalette, Toasts, ConfirmDialog, EmptyState …),
       routes/(Login, Dashboard, PageEditor, CollectionList, DocEditor, Media, History, Audit, Users, Settings, Profile),
       styles/(tokens.css, base.css, components.css, forms.css, responsive.css)}
public/
  assets/{css,js,img}       # moved from /assets (unchanged files)
  assets/js/admin-inline.js # injected only in ?edit=1 renders
  admin/                    # Vite build output (gitignored)
content/
  content.md                # existing inventory (kept as reference)
  seed/*.json               # migrated structured content: site.json, home.json, …, events.json, …
scripts/{dev.ts, seed.ts, bootstrap.ts, export-golden.ts, check-facts.ts}
tests/
  unit/*.test.ts  store-contract.test.ts  golden/*.html  render.golden.test.ts  e2e/*.spec.ts
```

Retired at Phase 12: `build.py`, `src/`, `docs/`, root `assets/` (moved to `public/assets`).

## 11. Environment variables

| Var | Dev default | Prod | Purpose |
|---|---|---|---|
| `STORE_DRIVER` | `fs` | `postgres` (or `blob`) | store selection |
| `DATA_DIR` | `.data` | – | FS store + FS blobs |
| `DATABASE_URL` | – | Neon connection string | PostgresStore |
| `BLOB_READ_WRITE_TOKEN` | – | from Vercel Blob | media + Blob KV fallback |
| `SESSION_SECRET` | random per start (warned) | 32+ random bytes | HMAC for client-upload tokens and cookie integrity |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | `Phil` / `Phil` | `Phil` / `Phil` | first Owner, only when no users exist |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | `https://<domain>` | Origin checks, sitemap, preview URLs |
| `COOKIE_SECURE` | `false` | `true` | |
| `CACHE_SMAXAGE` / `CACHE_SWR` | `0` / `0` | `15` / `300` | public cache policy |
| `CDN_PURGE` | `off` | `tag` or `off` | enable `dangerouslyDeleteByTag('content')` on publish |
| `CRON_SECRET` | – | random | protects `/cron/settle` |
| `TZ_NAME` | `America/Los_Angeles` | same | schedule/date display |
| `MAX_IMAGE_BYTES` / `MAX_FILE_BYTES` | 8 MB / 15 MB | same | |

`.env.example` documents all; `server/config.ts` validates at boot and fails fast with a readable message.

## 12. Local development and test strategy

- `npm run dev`: `scripts/dev.ts` starts the Node server on :3000 (render + admin API + `/blobs/*` + static `public/`) and Vite on :5173 for `/admin/` with a proxy for `/api` → :3000. Cookies on `localhost` are shared across ports, so the preview iframe (`http://localhost:3000/...?preview=1`) authenticates. `PUBLIC_BASE_URL` for dev is `http://localhost:3000`; Origin check allows `http://localhost:5173` when `NODE_ENV !== 'production'`.
- `npm run seed` loads `content/seed/*.json` into the store (idempotent; refuses to overwrite docs with `version > 1` unless `--force`). `npm run bootstrap` creates the Owner.
- `npm run build` = `vite build` (admin) + `tsc --noEmit` (type check). Vercel runs it.
- Unit (Vitest): `password` (hash/verify/timing), `session`, `csrf`, `ratelimit` (lockout doubling), `permissions` (table-driven: every role × action), `validate` (every field type, good/bad), `richtext` (XSS corpus, link scheme rejection), `revisions` (coalescing, sealing rules, restore), `publish`/`restore` (snapshot correctness, site restore manifest), `diff` (list key matching), `health` rules, store contract (FS always; Postgres/Blob when env present), `render.golden` (seed → every page equals `tests/golden/*.html` after normalization), `check-facts` (every URL, email, dollar amount, and name in `content/content.md` appears in the rendered HTML).
- E2E (Playwright, Chromium, against a built app on :3000 with a temp `DATA_DIR`): the smoke flow in Phase 7 and the permissions flow in Phase 11 (see phases).
- Golden normalization: collapse inter-tag whitespace, map `href="x.html"`→`/x` and `index.html`→`/`, strip `?v=` asset hashes, ignore the utility-bar admin link. Updating goldens requires `UPDATE_GOLDEN=1` and is a reviewed change.

## 13. Conventions for Codex

- TypeScript strict, ESM, Node ≥ 22 (`engines`), no `any` in `server/` and `shared/`. No new dependencies beyond: `hono`, `@neondatabase/serverless`, `@vercel/blob`, `@vercel/functions`, `diff`, `preact`, `@preact/signals`, `preact-iso`; dev: `@types/node@^22`, `typescript`, `vite`, `@preact/preset-vite`, `vitest`, `@playwright/test`, `tsx`. Ask (stop and report) before adding anything else.
- Every API route: `requirePermission` → validate → store → audit. Every store call goes through the `Store` interface; no driver-specific code outside `server/store`.
- Public HTML must keep every class name, attribute and structure from the existing pages; the golden test is the arbiter. Do not "improve" markup.
- No emojis in UI copy. Sentence case. Toast copy ≤ 60 chars.
- Each phase ends with: `npm run build && npm test` green, a short CHANGELOG entry in `plans/admin-progress.md` (what shipped, deviations, open issues). If a requirement cannot be met, say so explicitly rather than approximating silently.

## 14. Phases

Each phase is one Codex run (`codex exec --sandbox workspace-write -m gpt-6.1-sol`, high reasoning), independently testable, reviewed by Fable before the next starts. Estimated size is relative (S/M/L).

### Phase 0 — Scaffold and tooling (S)
Scope: `package.json`, TS config, Vite config (root `admin/`, base `/admin/`, outDir `../public/admin`), Vitest, Playwright config, `scripts/dev.ts` (static + placeholder routes), `vercel.json` (rewrites/redirects/headers/crons as in §2 and §6), `.env.example`, `.gitignore`, move `assets/` → `public/assets/`, `server/config.ts`, `server/http/hono-app.ts` with `GET /api/admin/healthz`. Keep `build.py`/`docs/` untouched for now. Pin `@vercel/functions@^3.11.0` (exports `addCacheTag`, `dangerouslyDeleteByTag`; confirmed 2026-11-09) and wrap both in `server/render/cdn.ts` so local dev no-ops when not on Vercel.
Acceptance: `npm run dev` serves `docs/index.html` at `/` (temporary) and `/api/admin/healthz` → `{ok:true}`; `npm run build` and `npm test` (one trivial test) pass; `vercel.json` validates (`npx vercel build` not required).

### Phase 1 — Schema, validation, store interface, FS store (M)
Scope: `shared/schema.ts` (all collections and fields from §3, complete), `shared/types.ts`, `server/content/validate.ts`, `server/content/ids.ts`, `server/store/types.ts`, `kv-store.ts` + `primitives/fs.ts`, `blobs/fs.ts`, `store/index.ts`, contract test suite, validator tests for every field type.
Acceptance: contract tests pass on FS; `validate()` rejects bad URLs/emails/dates/money and accepts the seed shapes; schema compiles and exports a `collections` map consumed by both server and client.

### Phase 2 — Renderer core + migration of home/site/shared collections (L)
Scope: `server/render/html.ts`, `richtext.ts` (+XSS tests), `icons.ts` (extract every inline SVG used in pages into named icons), `links.ts`, `templates/layout.ts` and `templates/home.ts`; seed JSON for `site`, `home`, `events`, `callouts`, `results`, `sponsors`, `sponsorTiers`, `media` (static images with current alts); `scripts/seed.ts`; `scripts/export-golden.ts` copies `docs/*.html` into `tests/golden/`; golden test for `index.html`; `server/render/handler.ts` and `api/render.ts` wired to the snapshot (snapshot built from seed `published = draft`). Dev server serves `/` from the renderer; other pages still from `docs/` temporarily.
Acceptance: rendered home equals golden after normalization; `check-facts` passes for the Home/Global/Sponsors sections of `content.md`; `curl localhost:3000/` returns `ETag` and the configured `Cache-Control`.

### Phase 3 — Migration of the remaining seven pages (L)
Scope: templates and seed for `recreational`, `competitive`, `referees`, `sponsors`, `board`, `resources`, `about`; collections `teams`, `boardMembers`, `documents`, `faqs`; `notfound.ts`, `robots.txt`, `sitemap.xml`, clean-URL redirects in the dev server; `editable.ts` annotations (`data-edit` emitted only when `edit=1`).
Acceptance: all 8 goldens pass; `check-facts` passes for the whole inventory; `/recreational.html` → 308 `/recreational`; 404 page renders with site chrome; `docs/` no longer served by the dev server.

### Phase 4 — Auth, users, sessions, permissions, audit, admin API skeleton (M)
Scope: `server/auth/*`, `permissions.ts` + `shared/permissions-table.ts`, `audit.ts`, Hono middleware (errors, auth, csrf, permission, ratelimit), routes `auth/*`, `users/*`, `audit` (+export), `bootstrap.ts`, `scripts/bootstrap.ts`, `docs` read routes. Tests: password, session, csrf, ratelimit, permissions table, bootstrap idempotence, route-level 401/403 matrix.
Acceptance: `POST /auth/login` with Phil/Phil sets the cookie and returns `passwordWeak: true`; wrong password 5× locks for 15 min and is audited; Viewer gets 403 on `POST /docs/events`; Admin cannot create an Owner; last Owner cannot be demoted; `GET /audit/export?format=csv` streams rows.

### Phase 5 — Revisions, publish, restore, scheduling engine (M)
Scope: `server/content/{revisions,publish,restore,diff,schedule,search,health}.ts`; routes `docs` write/reorder/trash/duplicate/review, `publish`, `unpublish`, `schedule`, `pending`, `revisions/*`, `publishes/*`, `cron/settle`, `search`, `dashboard`, `health/links`; renderer honours `preview`/`edit` (session required) and `scheduled[]` with cache cap; CDN purge hook. Tests: coalescing/sealing, CAS 409, publish snapshot, revision restore, site restore (including docs created after V), schedule settle, diff on lists.
Acceptance: full lifecycle via HTTP in tests: create → edit (same author within 10 min → one revision) → publish (siteVersion 2) → edit → restore site to 1 → snapshot equals version-1 content and a new publish record exists; `?preview=1` without session → 401; health check flags a past event and a missing alt.

### Phase 6 — Production storage adapters (M)
Scope: `postgres-store.ts` + `postgres-schema.sql` (+ `scripts/db-migrate.ts` applying it idempotently), `primitives/blob.ts`, `blobs/vercel.ts`, media upload-token route (`@vercel/blob` client upload), contract tests gated by env, `README-deploy.md` section (Vercel project setup, marketplace Neon + Blob, env list, `vercel --prod`).
Acceptance: contract suite passes against a real Neon database and a Blob store (Chris provides env for a one-off run, or Codex reports "not run" explicitly); `STORE_DRIVER=blob` runs the Phase 5 lifecycle test end to end; a Vercel preview deploy serves the public site from the snapshot.

### Phase 7 — Admin SPA shell, login, lists, generic editor, autosave (L)
Scope: Vite app, design tokens/CSS, Shell (sidebar, top bar, responsive tabs), Login, session state, API client with CSRF, Dashboard (counts + recent activity, health list rendered from API), CollectionList (search/filter/sort, status pills, trash tab, bulk select), generic Form engine for every field type except image/file (placeholder), ListEditor with drag + keyboard reorder, DocEditor with autosave/status/unsaved guard/conflict merge panel/undo, Toasts, ConfirmDialog, EmptyState, weak-password banner, `localStorage.psc_admin` flag; public utility-bar "Admin" link + "Edit this page" enhancement. Playwright smoke v1: `/` → Admin → login → dashboard → create event → appears in list → edit → autosaved.
Acceptance: all screens usable at 390 px and 1280 px; keyboard-only navigation works through login, list and editor; Lighthouse accessibility ≥ 95 on Dashboard and an editor (manual check acceptable, report numbers); smoke v1 green.

### Phase 8 — Preview, publish tray, scheduling, inline edit mode (M)
Scope: Preview pane with device toggle and field outline/scroll-to, PageEditor with section accordion, PublishTray with diff summaries and notes, Publish split-button (now/schedule/request review), "View live" with `?v=`, `public/assets/js/admin-inline.js` + `postMessage` bridge, inline plain-text editing and popover for other field types, `?edit=1` CSP/frame rules. Smoke v2 adds: publish → fetch `/` (no cache) contains the new event title; schedule → not visible → settle → visible.
Acceptance: inline edit of the home hero lead autosaves and appears in Pending; publishing from the tray updates the live page; preview for a Contributor works; a Viewer sees the tray read-only.

### Phase 9 — History and audit UI (M)
Scope: Timeline component (revisions with author, time, action, summary), DiffView (field + word level, list moves), Restore revision (with optional publish), Site versions screen with "Compare with current" and "Restore site to this version" (confirmation lists changes), Audit screen with filters, infinite scroll, row detail, export.
Acceptance: smoke v3 adds: edit title twice → History shows two sealed revisions after a checkpoint → restore first → publish → live page shows restored title → Audit shows login, edits, publish, restore in order; export CSV downloads with the active filter.

### Phase 10 — Media library and documents upload (M)
Scope: Media screen (grid, filters, dropzone, client-side resize/WebP, progress, details drawer, alt/caption/focal picker, usage, replace, delete rules), Image/File field controls in the form engine (picker drawer, alt per use, focal preview), documents `source.mode: upload`, renderer uses media URLs and focal `object-position`, migration of static images visible in the library.
Acceptance: upload a JPEG → web variant ≤ 2000 px WebP stored → assign to a sponsor logo → publish → live page serves the Blob URL with alt; deleting an in-use image is refused with the usage list; health check "missing alt" clears after editing.

### Phase 11 — Users, roles, profile, review flow, dashboard polish, palette and shortcuts (M)
Scope: Users screen (add with one-time temp password, role editing with ceilings, deactivate, reset password, sign-out-everywhere), Profile (change password with meter, sessions), Contributor review flow (request → "Awaiting review" dashboard card → Editor approves = publish or returns with note), CommandPalette, shortcut sheet, `[`/`]` navigation, dashboard health check deep links and "Rebuild snapshot" action, "Also editing" indicator. E2E permissions spec: Owner creates Contributor → Contributor logs in, edits, cannot publish (UI hidden, API 403), requests review → Owner publishes.
Acceptance: permissions spec green; palette opens with ⌘K and executes "Publish all"; all admin screens pass an axe scan with no serious violations (Playwright `@axe-core/playwright` is NOT added — use Lighthouse/manual and report).

### Phase 12 — Cut-over and cleanup (S)
Scope: remove `build.py`, `src/`, `docs/`, root `assets/`; update `README.md` (architecture, dev, deploy, roles, restore runbook); final `vercel.json` review; `scripts/export-golden.ts` retired (goldens stay in `tests/golden`); `seo.indexable` default confirmed `false`; final full test run; deployment checklist for Chris (`vercel link`, env, `npm run db:migrate`, `vercel --prod`, visit `/admin`, sign in as Phil, change password).
Acceptance: repo has a single build path; `npm test` + both Playwright specs green; production deploy serves identical public HTML (golden normalization) and the Admin login works.

## 15. Risks and mitigations

- CDN purge-by-tag is a library call that can still fail at runtime (plan restriction, outage) → correctness never depends on it (SWR window + `?v=` for editors); the SPA reports whether the purge succeeded.
- Hobby plan limits (12 functions, daily cron, non-commercial terms) → 2 functions; scheduling evaluated at render; confirm plan with Chris.
- Blob-only fallback has a CAS race → documented; Postgres recommended.
- Golden tests are strict → they protect content fidelity, which is the main migration risk; templates must match markup exactly.
- Large phases (2, 3, 7) → each has a narrow, mechanical definition and an objective acceptance test; split further if a run stalls.
- Function cold starts reading the snapshot → in-instance cache keyed by `siteVersion`, one small query to check version.

## 16. Open questions for Chris

1. Vercel plan: Hobby or Pro? (Affects cron frequency and purge availability; both handled, but good to know.)
2. Confirm storage: Neon Postgres + Vercel Blob via the Marketplace (recommended), or Blob-only to start?
3. Clean URLs (`/recreational`) with 308 redirects from `.html` — OK?
4. Keep the site `noindex` by default (setting `seo.indexable=false`) until the club adopts it?
5. Rich text as a constrained Markdown subset with a toolbar (recommended) vs. a full WYSIWYG — acceptable?
6. Password resets are admin-performed (temporary password shown once); no email provider in scope — OK?
7. Should the public repo keep hosting the code once secrets move to Vercel env (yes by default), or move to a private repo?
8. Is a custom domain planned now (affects `PUBLIC_BASE_URL`, cookie `Secure`, and the sitemap), or use the `*.vercel.app` URL for v1?

## 17. Decisions on open questions (Claude, 2026-11-09 — defaults pending Chris)

1. Assume Vercel **Hobby**: daily cron only; scheduling evaluated at render time as designed; purge failure tolerated.
2. Storage: implement **Postgres (Neon) + Blob** as recommended **and** the Blob-only `KvStore` fallback; the deployed driver is chosen by `STORE_DRIVER` once Chris's account access is known. FS driver for dev/tests.
3. Clean URLs with 308 redirects from `.html`: **yes**.
4. Keep `noindex` by default (`seo.indexable=false`): **yes**.
5. Constrained Markdown subset + toolbar: **yes**.
6. Admin-performed password resets only, no email provider: **yes**.
7. Keep code in the public repo (secrets only in Vercel env): **yes**.
8. Use the `*.vercel.app` URL for v1; no custom domain yet.

Hosting credentials are not yet available (pending Chris authorizing ChrisBot). Phases 0–5 and 7–12 must be fully runnable locally with the FS driver; Phase 6 real-service contract tests report "not run" if env is absent.

## 18. Review amendments (2026-11-09)

Source: independent reviews of the Phase 0–1 snapshot by Fable (plan author) and Astra. Earlier sections stay as written; where this section conflicts with them, this section wins. Codex: implement these in the phase named for each item; nothing here changes Phases 2–3, which are in flight.

### 18.1 Decisions changed

| Topic | Was (§) | Now |
|---|---|---|
| Production storage | Postgres **or** Blob-KV fallback (§0, §4, §17.2) | **Postgres (Neon) for all metadata; Vercel Blob for media binaries only.** `KvStore` + `FsPrimitives` remain for dev/tests. The `primitives/blob.ts` KV driver is **dropped** from Phase 6; `STORE_DRIVER` accepts `fs | postgres` only. |
| Bootstrap credential | `Phil`/`Phil` defaults in code and `.env.example` (§6.1, §11) | Chris's requested `Phil`/`Phil` stays as the *dev* default. In production (`NODE_ENV=production`) `ADMIN_BOOTSTRAP_USER`/`ADMIN_BOOTSTRAP_PASSWORD` have **no code default**: `loadConfig` fails fast if either is unset. `.env.example` lists `ADMIN_BOOTSTRAP_PASSWORD=` **empty** with a comment ("set locally; Chris's chosen value is not committed"). Not forced to change (explicit request), but: `passwordWeak` ⇒ a persistent, prominent banner on every admin screen with a one-click path to Change password, dismissible only per session; dashboard health check "Owner password is weak"; **every** login attempt (success, failure, lockout) is audited with IP/UA (`auth.login`, `auth.login_failed`, `auth.locked`). |
| Conflict handling | Per-field merge panel + auto-merge (§7.3) | **v1: 409 ⇒ "Someone else saved this. Reload and compare"** — the SPA shows the server doc next to the local draft with the schema-aware DiffView (§7.1) and two actions: *Discard mine / Keep mine (overwrite, with a new revision)*. Per-field merge moves to a post-v1 backlog. Polling "Also editing" indicator stays. |
| Reorder reversibility | Reorder = audit only; manifests omit order (§5, §7.4) | `order` is part of the versioned state: `Snapshot.docs[].order` and `PublishRecord.manifest[].order` are required; site restore restores order. Reorder still writes one audit entry and no per-doc revision, but bumps each moved doc's `version` through the atomic mutation API (18.2.3). |
| Store API | Separate `updateDoc` / `upsertWorkingRevision` / `appendAudit` (§4.1) | One atomic content mutation call (18.2.3). `publish(tx)` takes `{ expectedVersion, nextDoc }` pairs (18.2.4). |

### 18.2 Phase 1b — Store and baseline remediation (M)

Runs **after Phases 2–3 and before Phase 4**. One Codex run. Nothing in Phase 4+ may build on the pre-1b store API.

1. **Build baseline.** Add `@types/node@^22` to devDependencies and update the lockfile; add it to the §13 allowlist. Acceptance: `rm -rf node_modules && npm ci && npm run build` passes.
2. **Vercel entrypoint shape.** Vercel's Node runtime treats a bare default-exported function as a `(req, res)` Node handler, not a Web `Request` handler. `api/render.ts` and `api/admin.ts` must export the Web-standard shape the runtime dispatches on: `export default { fetch: renderPublic }` / `export default { fetch: (req: Request) => adminApp.fetch(req) }` (or `export const GET/POST = …` named method handlers — pick one, document it in `README`). Acceptance: a unit test imports both modules and invokes them exactly as the runtime does (object with `fetch` receiving a `Request` built from a Node `IncomingMessage`-style URL/headers) and asserts `/` → 200 HTML and `/api/admin/healthz` → `{ok:true}`; a second test asserts the modules do **not** export a bare function.
3. **Atomic content mutation API.** Replace the trio of calls with one Store method:
   ```ts
   mutateDoc(m: {
     collection; id; expectedVersion: number;            // CAS; 'conflict' if mismatch
     patch: Partial<Doc>;                                 // version := expectedVersion + 1 (store-enforced)
     revision?: { upsert: Revision } | { append: Revision }; // working-revision upsert or new sealed/unsealed revision
     seal?: string[];                                     // revision ids to seal in the same write
     audit: AuditEntry;                                   // required: no silent mutation
   }): Promise<Doc | 'conflict'>;
   ```
   Rules enforced by every adapter: the upserted revision must satisfy `rev.docId === id`, `rev.docVersion === expectedVersion + 1`, and `rev.docVersion > old.docVersion` (reject stale/decreasing `docVersion`); sealed revisions are immutable; in KV the doc write happens **last** so a crash never leaves a doc ahead of its history; in Postgres it is one transaction. `createDoc` likewise takes `{ doc, revision, audit }`. `updateDoc`, `upsertWorkingRevision`, `appendRevision`, `sealRevision`, `appendAudit` are removed from the public interface (kept private inside adapters if useful). Acceptance: contract tests for conflict, stale `docVersion` rejection, interleaved saves from two instances producing monotonic history, and failure injection at each KV write proving the doc is never newer than its latest revision.
4. **Publish transaction shape.** `PublishTx.docs` becomes `{ expectedVersion: number; nextDoc: Doc }[]`; the store CAS-checks `stored.version === expectedVersion` and writes `nextDoc` (whose `version` may be `expectedVersion` or `expectedVersion + 1`, e.g. restore). Acceptance: a restore-style publish that increments versions succeeds atomically; a stale `expectedVersion` rejects before any write.
5. **Kind-tagged publish records and recovery.** `PublishRecord.kind: 'publish' | 'unpublish' | 'schedule' | 'restore' | 'rebuild'`. Every snapshot change goes through `publish(tx)` and creates a record — unpublish and schedule-cancel included (replaces "republishes the snapshot" wording in §7.5). KV write order: docs → revisions → audit → record → snapshot; each step idempotent on retry (same ids ⇒ same keys ⇒ overwrite with identical content is allowed, **different** content under an existing id is rejected). Add `store.recoverPublish(): Promise<{ repaired: boolean; siteVersion }>` which, when `publishes/<n+1>` exists but the snapshot is at `n`, rebuilds the snapshot from the stored `published` fields and record manifest (`kind: 'rebuild'` is *not* a new version; it completes the pending one). The admin API calls `recoverPublish` lazily on the first publish/dashboard request after an error. Acceptance: failure-injection tests at **each** of the five write steps, followed by retry or `recoverPublish`, end in a consistent state (snapshot, record, docs agree) with no duplicate records.
6. **Snapshot / manifest completeness.** `Snapshot` gains `schemaVersion: number` (from `shared/schema.ts` `SCHEMA_VERSION`), `docs[].order`, `scheduled[]` as today **plus** `effectiveAt` bookkeeping (18.4.4), and `media: Record<mediaId, { url; mime; width; height; alt }>` — an immutable copy of every media record referenced by published docs, so historical versions render even after a media record is edited. `PublishRecord.manifest[]` gains `order`. Media binaries referenced by any publish record are never deleted (media "delete" = trash flag; binary GC is out of scope for v1).
7. **Ids and KV layout.** Ids are time-sortable: `rev_<ISO-ms base32>_<rand6>`, `aud_<…>`, `pub` stays the padded site version; doc ids unchanged. Keys: `revisions/<docId>/<revId>.json`, `audit/<yyyy-mm>/<auditId>.json` (no `<at>` in keys; existence check = one `get`). `getRevision(docId, revId)` and `listRevisions(collection, docId, …)` are scoped by doc; `queryAudit` without filters reads months newest-first until `limit` is satisfied. `FsPrimitives.list(prefix)` walks only the prefix directory. `createDoc` checks `docs/<collection>/<id>` only (ids already carry the collection prefix; Postgres keeps `id` as PK). Acceptance: a contract test with 500 revisions across 20 docs asserts `getRevision` performs ≤ 2 primitive reads (count via a wrapping `KvPrimitives`).
8. **Stale-lock recovery.** `FsPrimitives.exclusive` writes `{ pid, at }` into `.store-lock/owner.json`; a waiter steals the lock when the pid is not alive or `at` is older than 30 s, logging a warning. Acceptance: test kills nothing but plants a lock with a dead pid and an old `at`, and the next mutation succeeds within 1 s.
9. **Validation tiers.** `validate(collection, data, { mode: 'draft' | 'publish', resolve })`. `draft`: current behaviour plus defaults applied **on create** by the API (`default`/`defaultFrom`), default `maxLength` 500 for `text`, 5 000 for `multiline`, 20 000 for `richtext`, and a 1 MB JSON body cap on `/api/admin`. `publish`: additionally every `reference` must resolve to an existing, non-trashed doc of the declared collection; every `image`/`file` to a media record of the right kind; singletons must contain every required section (`validate('home', {})` fails in publish mode). Acceptance: tests for each rule; the `publish` route rejects with `validation` 422 listing paths.
10. **Small fixes.** `toLowerCase()` (not `toLocaleLowerCase`) for username index keys; `playwright.config.ts` `webServer` runs with `DATA_DIR=<mkdtemp>` and `PW_CHANNEL` default; remove `Cache-Control: no-store` from `/admin/assets/*` (hashed) while keeping it on `/admin/index.html`.

Phase 1b acceptance overall: `npm ci && npm run build && npm test` green from a clean checkout; `plans/admin-progress.md` CHANGELOG lists every item above as done or explicitly not done.

### 18.3 Security and integrity rules (Phase 4/5 unless noted)

1. **Referential integrity.** `POST …/trash` on a doc referenced by any other draft or published doc is refused: 409 `{ error: { code: 'in_use', details: { usage: [{collection,id,title,path}] } } }`; the SPA shows the list with links. The renderer skips unresolved references defensively and the dashboard health check "Broken reference" lists them.
2. **Link checker SSRF.** Only `http:`/`https:`; resolve DNS first and refuse loopback, link-local, RFC 1918, ULA, multicast and metadata (`169.254.169.254`) ranges; no redirects to such ranges (follow ≤ 3 redirects, re-checking each); 8 s timeout; 1 MB response cap; `HEAD` then `GET` fallback; concurrency 5. Tests with a local stub server on 127.0.0.1 must be **refused**.
3. **Upload quarantine (Phase 10).** Client uploads land under `media/incoming/<token>/…`; `POST /media` finalizes only after the server fetches the blob, verifies magic bytes against the declared mime, size limits (§6.2), image dimensions, and rejects SVG; the verified file is copied to `media/<yyyy>/<mediaId>/…` and the incoming copy deleted. Unfinalized incoming blobs are GC'd after 24 h by the cron. Media records are created only at finalize.
4. **Cache correctness with schedules.** `ETag` = `W/"<siteVersion>-<templateHash>-<scheduleStateHash>"` where `scheduleStateHash` hashes the set of scheduled items whose `at` ≤ now. When any scheduled item is due within the SWR window, respond with `s-maxage=<seconds until due>, stale-while-revalidate=0`; otherwise the normal policy. Copy: "Live now" only when the purge returned `true`; otherwise "Live within about 5 minutes" (SWR 300 s is the real bound, not 30 s — §2 wording corrected).
5. **Authorization matrix fixes (§5 vs §6.3).** Reorder requires `content.trash`-tier (Editor+) to match §6.3 — rename the permission to `content.manage` covering reorder, trash, media.delete, link check. Editing the `site` singleton via the generic `PUT /docs/site/site` requires `site.settings`; `requirePermission` receives the collection and applies this ceiling.
6. **Session GC.** `Store.deleteExpiredSessions(now)`; called by the cron and lazily (≤ once per hour) on login. Sliding refresh writes at most hourly as in §6.1.

### 18.4 Re-sequenced phases

Phases 0–3 unchanged. Then:

| Order | Phase | Change |
|---|---|---|
| 4 | **1b** Store and baseline remediation | new (18.2) |
| 5 | **4** Auth, users, sessions, permissions, audit | as written + 18.1 bootstrap rules, 18.3.5, 18.3.6 |
| 6 | **5** Revisions, publish, restore, scheduling | on the 1b API; `recoverPublish`, kind-tagged records, 18.3.1, 18.3.4 |
| 7 | **6** Production storage | **Postgres + Vercel media blobs only**; contract suite (incl. 1b failure-injection tests) against Neon when env present |
| 8 | **7a — Vertical slice (M)** | **new.** Minimal SPA: Login → Dashboard (pending count only) → Events list → Event editor (generic form, autosave, 409 reload-and-compare) → Preview pane → Publish → History timeline with Restore. Plus the public utility-bar Admin link. Acceptance: Playwright flow `/` → Admin → login as Phil → create event → preview shows it → publish → `/` contains it → edit → restore first revision → publish → `/` shows original; run at **390 px and 1280 px**, once **keyboard-only**; weak-password banner visible; Lighthouse a11y ≥ 95 on login and editor. No other editors, no palette, no inline edit, no media yet. |
| 9 | **7b** Breadth: remaining editors, page editors, collection lists, list editor, trash, bulk | former Phase 7 minus the slice |
| 10 | **8** Publish tray, scheduling, inline edit | as written; inline edit may slip to post-v1 if 7b runs long |
| 11 | **9** History & audit UI | as written (DiffView already exists from 7a's compare screen) |
| 12 | **10** Media | as written + 18.3.3 |
| 13 | **11** Users, roles, review flow, palette, shortcuts | as written |
| 14 | **12** Cut-over | as written; deployment checklist adds "set `ADMIN_BOOTSTRAP_*` env before first request" |

Rule: nothing from 7b onward starts until the 7a Playwright flow is green on the FS driver and, once env exists, on Postgres.

## 19. Account decision (Chris, 2026-11-09)

- Initial accounts: **Phil** (Owner) and **Chris** (Owner), with strong passwords chosen by Chris. Plaintext passwords never enter the repo, logs or tests.
- Password changes are **allowed but never required**: `ADMIN_FORCE_PASSWORD_CHANGE=false` in production.
- Bootstrap supports multiple users via `ADMIN_BOOTSTRAP_USERS` (secret env): a JSON array of `{ "username", "displayName", "role", "passwordHash" }` where `passwordHash` is the exact string produced by `server/auth/password.ts` (scrypt). Bootstrap is idempotent: it creates missing users only, never overwrites an existing user's password or role, and audits each creation. `scripts/hash-password.ts` reads a password from stdin (no echo, never logged) and prints the hash. The single-user `ADMIN_BOOTSTRAP_USERNAME/PASSWORD` path remains for dev.

## 20. Phase 7b fix-up review (2026-11-09)

Reviewed the interrupted working tree before editing, including the existing Phase 7b implementation, all six supplied `error-context.md` files and all 19 supplied PNGs. The artifact directory contains no trace archive. This fix-up retains the architecture, dependency allow-list, filesystem driver and public golden fixtures.

### Failure findings and fixes

| Failure | Classification and root cause | Fix and coverage |
|---|---|---|
| Breadth publish at 390px leaves the dialog open | App race. The snapshot shows a real stale-version rejection. The editor's flush callback returned immediately for an unchanged draft even while a checkpoint was in flight. The tray could capture pending versions before that checkpoint advanced them. | Always await the editor save queue before reading pending changes. Keep genuine server conflicts visible and require explicit reload. A component-effect regression verifies that the publish/navigation callback remains pending until the clean checkpoint finishes. |
| Event workflow at 390px fails to show Saved after Location | App race. Phase 7b adds content-change refreshes. A poll could start before an edit/save and finish afterwards, replacing the current base version or draft with an older response. The next save then conflicts with the editor's own write. | Refresh compares the captured document/draft identities at completion, rejects older/equal versions and ignores disposed or saving editors. Local edits survive delayed responses. Dirty drafts still receive an other-editor notice. Deferred-response unit cases cover the interleavings. |
| Event workflow at 1280px fails at the same Location step | Same app race as the 390px workflow, with the same guarded-refresh fix and coverage. | Retained both viewport flows and added an API assertion that Location was actually saved before preview/publication. Browser confirmation remains pending. |
| Keyboard-only Events navigation times out | Accessible-name regression in the app. The visible sidebar count changed the link name from “Events” to “Events 10”; the snapshot contains the link. The exact-name selector therefore never resolves, before keyboard reachability can be tested. | Keep visual counts and exclude them from the accessible name with `aria-hidden`. Component coverage checks the counted link and its focus eligibility. Keyboard helpers explicitly await visibility before tabbing. |
| Weak-password reminder region is absent | Test isolation failure. The snapshot is still on Login with “Too many requests” and a retry countdown. The suite exceeds the shared localhost IP's ten-login budget. No evidence of a banner-rendering regression appears in this failure. | Every e2e test receives a fresh login budget in its isolated FS store through the existing Store API. Application rate limits and socket-peer handling stay intact. The reminder spec first verifies successful login. Component coverage checks banner visibility and session dismissal across a shell remount. |
| Trash/bulk/keyboard reorder expects an empty list after Undo | Test race plus an app labelling defect. `allTextContents()` captured `[]` before rows loaded. Repeated “Team” titles also cannot identify ordering because seeded teams have no names. | Await the loaded rows and compare stable editor hrefs, including the exact expected swap and Undo. Unnamed team labels use age group, gender and level, with unit coverage. |
| Intermittent concurrent hashed bootstrap unit failure | Test ordering assumption. The filesystem writer lock provides mutual exclusion, without promising which concurrent caller wins. Either caller may return `true`; exactly one must do so. Existing account and audit assertions remain valid. | Assert one successful creator regardless of result position. Preserve concurrent execution and all credential, role and exactly-once audit assertions. No bootstrap implementation change is needed. |

### Acceptance and verification status

- Phase 7a event create/edit/autosave/preview/publish/restore coverage is retained. Phase 7b remaining collection and page editors, shared forms, trash/bulk/reorder, reference usage and public-render coverage are retained. Browser specs close editor pages before restoring the seed publication, and the slice now restores its publication too, protecting subsequent public golden comparisons from successful test edits.
- No dependency, hosting credential, public asset, seed or golden-fixture changes were required. All executed application tests use FS storage.
- Final local command results and repeated bootstrap checks are recorded in the matching `plans/admin-progress.md` changelog.
- Playwright execution and Lighthouse accessibility scores remain **not run (sandbox)**. Unit/component checks do not establish browser focus, visual layout or a Lighthouse score. Real Neon and Blob checks remain **not run (no env)**. Claude must rerun the 22 browser specs with installed Chrome to close the browser acceptance gate.

## 21. Phase 9 browser fix-up (2026-11-09)

Reviewed the complete plan (including §17 and its §18 overrides), prior progress, `.cache/e2e-failures/run.txt`, all four failing test contexts and the relevant existing components/state/server tests before changing code. The supplied failing contexts contain error/source excerpts, without runtime page snapshots or traces. The supplied desktop event-editor screenshot is from a successful sibling test. Existing uncommitted Phase 9 work is retained.

| Failure | Classification and root cause | Fix and coverage |
|---|---|---|
| `admin-history.spec.ts:46`, both 390px and 1280px: missing checkpoint, then `sealedAt` on `undefined` | **App action race, compounded by test synchronization.** Leaving Title starts a blur autosave. Both checkpoint buttons used `disabled={saving}`, so the control could be disabled between pointer-down/blur and click; no checkpoint request was sent. The spec accepted the ordinary autosave's `Saved` status as proof of the requested checkpoint, then dereferenced a missing revision. The server's checkpoint/sealing behavior is covered and remains unchanged. | Keep checkpoint controls operable during autosave and use the existing serialized `EditorState.save(true)` queue. The editor's publication control likewise delegates waiting to the existing tray flush. A component regression holds blur autosave pending, activates the footer checkpoint, then verifies two successive titles send checkpoint writes against the saved versions. The browser spec deliberately holds autosave in flight, clicks Checkpoint, waits for its specific successful checkpoint response and asserts sealed revisions explicitly before using them. |
| `admin-history.spec.ts:163`, labelled “audit scrolls … exports” | **App focus-containment gap, not a CSV equality failure.** The log shows that the 36-line export, loading all 35 rows and uniqueness checks passed. The failing assertion tests focus after Tab in the drawer. Native `showModal()` makes the background inert but does not enforce a continuous in-document Tab loop at the browser-chrome boundary. | Retain the native modal and add explicit forward/backward boundary wrapping among visible, enabled controls, with dynamic lookup for changing dialog contents. Capture the dialog for cleanup and preserve opener-focus restoration. Unit cases cover both boundaries, interior traversal, hidden/disabled/negative-tabindex exclusions, and one/no-control dialogs. E2E checks exact reverse/forward wrap plus repeated Tab/Shift+Tab, Escape and opener focus; all export/scroll assertions remain. |
| `admin-slice.spec.ts:57`, keyboard-only Preview activation | **App keyboard-navigation burden exposed by Phase 9's additional History/Audit links.** From Location, forward Tab traverses the remainder of the form and the embedded full public home page before cycling back to Preview. That frame contains dozens of its own links/controls; the combined route exceeds the helper's 100-Tab budget. The failure is at Preview, not at login or Events navigation. | Remove the passive embedded preview from sequential focus with `tabIndex=-1`; its existing “Open preview in a new tab” link remains keyboard-accessible for full-page exploration, and inline editing keeps its separate interactive frame. Component coverage checks this focus contract. The complete 7a keyboard create/edit/preview/publish/restore flow and original 100-Tab limit remain; its error now identifies the target and actual focused element. No public markup, CSS or links were changed. |

All four new component regression cases fail against the pre-fix components and pass with the fixes. `npm run build` and `npm test` pass (489 passed, 17 hosted-service skips), including all eight public goldens and the plain-Node packaging smoke. `npm run check-facts` passes 122 facts; `npm run test:e2e -- --list` discovers all 32 tests across nine specs. Browser execution, actual focus/visual verification and Lighthouse remain **not run (sandbox)**; Claude must rerun real Chrome to confirm the keyboard-path diagnosis and browser acceptance. Real Neon and Blob remain **not run (no env)**. No dependency, public-design, storage-architecture, commit, push or deployment changes were made.

## 22. Admin performance pass (2026-11-09)

Implemented under Chris's performance request. This supersedes the hourly sliding-session refresh and store-backed general API rate limiter in §6: sliding refresh is conditional at 15 minutes; general authenticated API traffic uses a 600-request/5-minute limiter per warm function instance. Login, password, upload limits and login lockouts remain durable. Revision maintenance makes at most one database claim per instance per ten minutes. Exceptional bootstrap/recovery, due schedules, periodic session refresh, maintenance and an expired/missing health cache can write; steady-state authenticated GET/HEAD requests do not.

Postgres uses `neon().query()` over HTTP for non-transactional statements and a warm shared Pool for transactions. Session/user/schedule-index reads share one statement. The `/counts` aggregate is folded into that statement, so the entire steady-state authenticated endpoint costs one SQL statement. `Store.adminCounts()` also independently executes one aggregate. Content/user transactions retain a schema-scoped advisory lock; sessions, counters, meta and maintenance use conditional row updates/upserts or row locks. `capturePublication` is one MVCC statement.

`GET /dashboard?section=counts|activity|health` supports independent loading; the original combined response is retained. `/counts` supplies navigation and dashboard badges. Computed content health is cached in meta for five minutes, with atomic mutation invalidation and a generation check against concurrent stale computations. Role-sensitive Owner findings and schedule errors are read live. Link checks still require their explicit POST. The client retains one session validation per page lifetime, prefetches page data alongside it, uses bounded in-memory document/list stale-while-revalidate caches, guards delayed responses and invalidates on writes/account changes. Navigation hover/focus prefetches data. Hashed admin assets are immutable for a year; the shell is no-store.

### Measured query/write counts

Owner session, warm application, current 145-document seed, no due schedules, no refresh/maintenance/cache expiry. Actual statements include BEGIN/COMMIT/advisory-lock SELECTs; writes count INSERT/UPDATE/DELETE statements. Before is the unmodified `admin-cms` HEAD; after is this pass. Both ran locally against disposable PostgreSQL 17 through the Neon driver. These are query counts, not production latency measurements.

| Endpoint (GET) | Before SQL / writes | After SQL / writes |
|---|---:|---:|
| `/api/admin/healthz` | 0 / 0 | 0 / 0 |
| `/api/admin/auth/me` | 11 / 1 | 1 / 0 |
| `/api/admin/docs/events` | 22 / 2 | 2 / 0 |
| `/api/admin/docs/home/home` | 22 / 2 | 2 / 0 |
| `/api/admin/pending` | 45 / 2 | 2 / 0 |
| `/api/admin/dashboard` (combined compatibility response) | 74 / 2 | 10 / 0 |
| `/api/admin/counts` | Not previously available; badges used dashboard | 1 / 0 |
| `/api/admin/dashboard?section=activity` | Not independently available | 2 / 0 |
| `/api/admin/dashboard?section=health` (cache hit) | Not independently available | 6 / 0 |

The FS acceptance tests independently count primitive writes and assert zero for warm me/docs/counts/pending/dashboard and HEAD. These figures exclude cold initialization and the explicitly periodic work above. Other history, search, export and mutation routes retain their contracts; mutation query counts vary with selected documents/revisions and are not benchmarked by this table. Database telemetry is available via `server/store/metrics.ts` and the `Server-Timing` auth, ratelimit, settle, handler, db, db_count and db_writes fields. DB duration sums SQL execution time, including overlap; it is not wall-clock handler duration.

Run `npm exec tsx scripts/bench-admin.ts -- http://localhost:3000` with `ADMIN_BENCH_USERNAME` and `ADMIN_BENCH_PASSWORD` in the environment, or set `ADMIN_BENCH_BASE_URL`. It performs one login, warms each endpoint, reports p50/p95 and timing headers, then revokes its own session. `ADMIN_BENCH_ITERATIONS` defaults to 20 (maximum 50). No credentials are embedded or printed. Use local/authorized preview targets; this pass did not benchmark production.


## 23. Handoff documentation and screenshot inventory

The handoff adds `HANDOFF.md`, `AGENTS.md`, a one-line `CLAUDE.md` pointer, and `docs/admin-manual.md`. `docs/` now contains documentation and screenshot output, independent of the retired static HTML build. No application behavior or public design is changed by this phase.

Run `npm run docs:screenshots` against a separately running built local FS server at `http://localhost:3000`, using an Owner account supplied through `PSC_DOC_USER` / `PSC_DOC_PASSWORD`. Run `npm run docs:screenshots -- --list` to list captures without credentials or a browser. The script uses installed Chrome, opens real screens/dialogs, and does not submit content, account, publication or restore mutations. Authentication/presence and existing read-side maintenance still run. No browser or image generation is claimed in the sandbox.

Every screenshot referenced by the manual is listed below. Desktop captures are 1280×800. The three phone captures are 390×800. Seeded queues can be empty, and history comparisons may have no differences. These remain truthful captures of the practice store.

| Screenshot output | Viewport |
| --- | --- |
| `docs/images/sign-in.png` | 1280×800 |
| `docs/images/dashboard.png` | 1280×800 |
| `docs/images/site-settings.png` | 1280×800 |
| `docs/images/pages.png` | 1280×800 |
| `docs/images/page-editor.png` | 1280×800 |
| `docs/images/inline-page-editor.png` | 1280×800 |
| `docs/images/events-list.png` | 1280×800 |
| `docs/images/event-editor.png` | 1280×800 |
| `docs/images/callout-editor.png` | 1280×800 |
| `docs/images/recreational-fees.png` | 1280×800 |
| `docs/images/competitive-costs.png` | 1280×800 |
| `docs/images/team-editor.png` | 1280×800 |
| `docs/images/result-editor.png` | 1280×800 |
| `docs/images/board-member-editor.png` | 1280×800 |
| `docs/images/sponsor-editor.png` | 1280×800 |
| `docs/images/sponsor-tier-editor.png` | 1280×800 |
| `docs/images/document-editor.png` | 1280×800 |
| `docs/images/faq-editor.png` | 1280×800 |
| `docs/images/media-library.png` | 1280×800 |
| `docs/images/media-details.png` | 1280×800 |
| `docs/images/media-focal-point.png` | 1280×800 |
| `docs/images/publish-review.png` | 1280×800 |
| `docs/images/publish-schedule.png` | 1280×800 |
| `docs/images/review-queue.png` | 1280×800 |
| `docs/images/item-history.png` | 1280×800 |
| `docs/images/item-restore.png` | 1280×800 |
| `docs/images/site-history.png` | 1280×800 |
| `docs/images/site-compare.png` | 1280×800 |
| `docs/images/site-restore.png` | 1280×800 |
| `docs/images/audit-log.png` | 1280×800 |
| `docs/images/users.png` | 1280×800 |
| `docs/images/add-user.png` | 1280×800 |
| `docs/images/profile.png` | 1280×800 |
| `docs/images/command-palette.png` | 1280×800 |
| `docs/images/keyboard-shortcuts.png` | 1280×800 |
| `docs/images/product-editor.png` | 1280×800 |
| `docs/images/bundle-editor.png` | 1280×800 |
| `docs/images/store-settings.png` | 1280×800 |
| `docs/images/phone-dashboard.png` | 390×800 |
| `docs/images/phone-preview.png` | 390×800 |
| `docs/images/phone-media.png` | 390×800 |

The PNG files must be captured and visually reviewed outside the sandbox before sharing an illustrated manual. Account and audit images should use practice data. The source manual and capture script are delivered independently of the PNGs.
