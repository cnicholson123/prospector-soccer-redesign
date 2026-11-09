# Admin / CMS implementation progress

## CHANGELOG — Phase 0: Scaffold and tooling — 2026-11-09

Shipped:

- Added the allow-listed Preact/Vite/Hono/TypeScript toolchain, lockfile, strict ESM config, Vitest and Playwright configs. `@vercel/functions` is pinned to the requested `^3.11.0` range. Node minimum is 22.12 (required by Vite); verified here on Node 25.9.0.
- Added `scripts/dev.ts`: public legacy pages and `/api/admin/healthz` on localhost:3000, Vite admin on localhost:5173, API/assets/blob proxies, and built-admin mode via `npm run start`. No hosting account is needed.
- Added validated environment configuration, `.env.example`, and local-only CDN no-op wrappers. Added two thin function entries, static-page bridge, daily cron configuration, clean-URL redirects, SPA rewrites, and security headers in `vercel.json`.
- Moved all 18 original assets to `public/assets/` without changing any byte. Left `docs/`, `src/`, and `build.py` untouched. Added a responsive, branded admin placeholder; sign-in and the editor remain Phase 7 work. No public Admin link yet (also Phase 7).
- Added a repository-local npm cache because the host's default cache is not writable in this sandbox. Playwright binaries and downloaded validation artifacts also stay in ignored `.cache/`; no global configuration was edited.

Acceptance and verification:

- `npm run dev`: verified `/` returns exactly `docs/index.html`, `/api/admin/healthz` returns `{ "ok": true }`, Vite serves `/admin/`, the Vite API proxy works, and public CSS is unchanged.
- `npm run build`: PASS (Vite build + strict TypeScript check).
- `npm test`: PASS; combined Phase 0/1 suite has 165 passing tests and two explicitly skipped hosted-service tests. All eight legacy pages are compared byte-for-byte against `docs/*.html`.
- Official `https://openapi.vercel.sh/vercel.json` schema validation: PASS using Python's installed `jsonschema.Draft7Validator`. The fetched schema mixes newer keywords with its older declared dialect, so the direct Draft 7 validator was used; the project configuration passes without modifying the schema or adding dependencies.
- Original Git assets versus moved files: PASS, 18/18 identical. `git diff --check`: PASS.
- Added an optional scaffold Playwright spec (not required by Phase 0/1): the HTTP/page/assets/health test passes. Both browser checks (390px and 1280px) are BLOCKED before any page code runs: Chromium's `bootstrap_check_in` for `MachPortRendezvousServer` is denied by the execution sandbox. `npm run test:e2e` therefore exits nonzero (1 pass, 2 browser-launch failures). No browser assertion or visual QA pass is claimed. A computer-use fallback also could not run: browser access host unavailable; safe Finder preflight was not approved. This is not evidence of a Screen Recording denial.

Deviations / open issues:

- `api/render.ts` and `server/render/handler.ts` were introduced as a minimal legacy bridge now, so Phase 0 routing has real destinations. Rendering from content still starts in Phase 2.
- The original `build.py` still reads root `assets/` and is intentionally unmodified. **Do not run it during the transition**: it removes/recreates `docs/` before attempting that now-missing asset path. Use the npm commands above. Retirement remains Phase 12 work.
- The daily cron is configured, but its handler/auth/schedule settlement belong to Phase 5. Vercel invokes cron with GET; Phase 5 must provide the authenticated GET wrapper for the plan's POST settle operation.
- No commit, push, deployment, global config changes, or hosting credentials were used.

## CHANGELOG — Phase 1: Schema, validation, Store interface, FS store — 2026-11-09

Shipped:

- Added `shared/schema.ts` with all 19 content definitions (nine singletons and ten collections), nested fields, required flags, stable list keys, defaults, relationships, and preview metadata. Both the server validator and the admin bundle consume the same `collections` map. System records are separate typed interfaces in `shared/types.ts`.
- Added all field-type validation, nested error paths, unknown-field rejection, URL scheme/credential/control-character checks, real calendar dates and zoned datetimes, money/range checks, source-mode requirements, and time-window ordering. Rich-text link URLs are checked here; escaped rendering and its full XSS corpus remain Phase 2 work.
- Added crypto-generated prefixed document IDs and eight-character list keys.
- Added the full `Store` and `MediaBlobs` interfaces; KV storage for documents/CAS, published snapshots/manifests, revisions, audit/filter/cursors, users/username index, sessions, rate counters, and metadata; filesystem primitives with atomic rename writes and traversal/symlink rejection; filesystem media storage; FS driver factories.
- FS mutations use a shared directory lock across cooperating instances/processes, beyond the baseline Blob read/compare/write race described in the plan. KV publish validates versions first and commits the snapshot last. It deliberately does not claim crash-atomic multi-file transactions.

Acceptance and verification:

- `npm run build`: PASS. `npm test`: PASS, 165 tests plus two hosted-service skips.
- Store contract covers every interface operation, persistence across instances, competing creates/CAS updates/rate hits, stale publish rejection, snapshot-last failure behavior, revision sealing/immutability, audit pagination, case-insensitive username collisions, session deletion, metadata, binary/stream blobs, and unsafe paths.
- Every field type has positive and negative validator cases. Complete generated migration-shaped objects for every collection and representative current event/sponsor/document data validate. Actual migrated `content/seed/*.json` files are Phase 2/3 work and do not yet exist.
- Neon contract tests: **not run (no env)**. Blob contract tests: **not run (no env)**. Hosted adapters are Phase 6 work; selecting one now fails clearly instead of silently falling back to FS.

Deviations / open issues:

- The plan gives `sponsors` to both a singleton page and a collection; a single map cannot represent both under one key. The singleton is named **`sponsorsPage`**, with preview page/public URL still `sponsors` / `/sponsors`; the sponsor collection stays **`sponsors`**. This choice was raised with Chris during implementation and is the documented default pending any correction. Phase 2/3 seed and renderer code must use `sponsorsPage` for the singleton.
- Icon names are reserved in the shared schema; extracting their actual SVG renderers remains Phase 2 work. Optional defaults are schema metadata, not mutations performed by validation.
- FS lock recovery after an ungraceful process death is manual: with all dev servers stopped, remove `DATA_DIR/.store-lock`. The lock times out rather than stealing an active writer's lock. This is a local-development limitation; production transactions remain Phase 6 work.
- No content migration, production service tests, sign-in, publishing engine, or admin editor is claimed in these two phases.
- Playwright uses the installed Google Chrome (channel 'chrome'); the Codex sandbox cannot launch browsers, so Claude runs e2e outside it.

## CHANGELOG — Phase 2 — Renderer core and home/shared migration — 2026-11-09

Shipped

- Added escaped tagged HTML, renderer-owned raw markup, constrained Markdown with XSS tests, URL normalization and render-time scheme checks. Extracted all 20 distinct legacy SVG bodies into named icons and implemented the six remaining schema-reserved icons.
- Added snapshot views, shared layout, home template and reusable collection templates. Seeded site, home, events, callouts, results, sponsors, sponsor tiers and all 16 static images. Image records preserve per-use alt text on page fields and store intrinsic dimensions. The JPEG and WebP hero assets have distinct IDs.
- Added `npm run seed`, with whole-migration validation, global ID uniqueness checks, edit protection, idempotent reruns, explicit `--force`, an initial published snapshot, sealed revisions and a restorable publish manifest. Development startup seeds an empty FS store automatically. Existing initialized stores are preserved.
- Added `scripts/export-golden.ts`, gated by `UPDATE_GOLDEN=1`. All eight fixtures were copied byte-for-byte from `docs/`. Added `npm run check-facts` for the inventory's URLs, email addresses, dollar amounts and named people, businesses and places.
- Wired the existing API entry to the snapshot renderer, with ETags, conditional GET/HEAD, configurable cache headers, CDN tagging and per-instance snapshot reuse keyed by site version. Callout windows and the local-midnight event cutoff cap the TTL. The ETag also includes a representation digest so clock-driven changes cannot receive an incorrect 304.
- Retained the original public CSS and JavaScript byte-for-byte, including client-side event dimming and the season dial.

Acceptance and verification

- Home golden passes. Home, Global and Sponsors inventory facts are covered by the whole-inventory check, which passes all 122 extracted facts.
- Local `npm run dev` with `STORE_DRIVER=fs`, a fresh repository-local data directory, `CACHE_SMAXAGE=15` and `CACHE_SWR=300` serves `/` with status 200, a weak ETag and `Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=300`.
- `npm run seed` and its repeat pass. Tests cover protected edits and explicit force, published/draft equality, sealed seed revisions and the initial manifest.
- `npm run build` passes. Combined Phase 0–3 suite passes 214 tests, with two hosted-service skips.
- Neon contract tests — **not run (no env)**. Blob contract tests — **not run (no env)**.

Decisions and remaining work

- Golden normalization additionally canonicalizes equivalent character-reference spellings and relative/root-relative asset paths. All elements, classes, attributes and text remain compared. Root-relative assets keep deep 404 URLs usable.
- Rendering helpers accept edit-mode annotations, but the HTTP route continues to deny preview/edit requests with 401 and `no-store`. Session-backed draft selection belongs to Phases 4–5.
- The unchanged client-side season-phase labels remain in `main.js` as required by this phase's preservation constraint. Their corresponding phase definitions are present in the home seed.
- No public Admin link or new admin screen was added. Those are Phase 7 scope.

## CHANGELOG — Phase 3 — Remaining seven pages — 2026-11-09

Shipped

- Added snapshot-driven recreational, competitive, referees, sponsors, board, resources and about templates and seeds. Migrated teams, board members, documents and FAQs, including all 11 teams, 14 board roles and 25 document records. The complete migration contains 111 documents across 19 content types.
- Added a branded 404, robots.txt and sitemap.xml driven by the site's indexing setting. The seed preserves `noindex`. Clean legacy URLs return 308 redirects with query strings retained.
- Added stable-key `data-edit` field addresses in explicit edit renders. Unit tests validate the emitted addresses against the schema and confirm ordinary public output contains no edit metadata.
- Removed the legacy static-page bridge. The development server now renders every public page from the Store snapshot, with no runtime reads from `docs/`. Removed the obsolete Vercel function include for legacy HTML.
- Updated the scaffold e2e spec and added renderer HTTP, redirect, crawler, preview-denial, responsive, filtering and no-JavaScript specs. Playwright uses an isolated repository-local FS directory and the installed Chrome configuration.

Acceptance and verification

- All eight golden comparisons pass through the renderer and the HTTP handler. The fixtures still match `docs/*.html` byte-for-byte.
- `npm run check-facts` passes all 122 extracted inventory facts.
- Local HTTP checks confirm `/recreational.html` returns 308 to `/recreational`, an unknown deep path returns a 404 with site chrome, `/robots.txt` disallows indexing, the health endpoint returns `{ "ok": true }`, and `?edit=1` returns 401 with `no-store`.
- Tests cover page edits, shared collection edits, ordering, added/empty lists, image URLs and per-use alts, callout activation/expiry, old-event filtering, timezones, midnight TTL caps, conditional requests and indexing opt-in.
- `npm run build` passes. `npm test` passes 214 tests, with two explicit hosted-service skips. `npm run test:e2e -- --list` discovers nine tests across two specs.
- Browser e2e and visual screenshots — **not run (sandbox)**. Claude must execute the specs with the installed Chrome. No browser or Lighthouse pass is claimed.
- Neon and Blob — **not run (no env)**.

Deviations and open issues

- Added the optional `documents.showInLibrary` boolean, defaulting to true. The existing competitive sponsorship PDF is referenced by its program page but absent from the original resources library. Its seed flag is false, preserving both pages without hard-coded document-ID exclusions.
- Continued the Phase 1 `sponsorsPage` singleton naming decision. `/sponsors` is unchanged and `sponsors` remains the collection.
- Public golden output is unchanged apart from the plan's clean URLs and equivalent escaped/root-relative spellings noted above. CSS, JavaScript, source pages and legacy built pages remain unchanged.
- Authenticated preview and the admin UI remain assigned to their later phases. Hosted storage and deployment remain Phase 6 work. No credentials, commits, pushes, deployments or global configuration changes were made.

## CHANGELOG — Phase 1b — Store and baseline remediation — 2026-11-09

Shipped against §18.2

1. Added `@types/node` in the v22 range to devDependencies, the lockfile and the §13 allow-list. A clean `npm ci` reinstalls the dependency tree successfully.
2. Both Vercel entrypoints now export `{ fetch }`. README documents the dispatch shape. Tests import both modules and dispatch Web Requests built from Node-style URL/header inputs, checking HTML and health JSON and rejecting a bare-function export shape.
3. Replaced the separate public content-write methods with `createDoc({ doc, revision, audit })` and `mutateDoc(...)`. CAS, immutable identity, revision identity/data/version checks, monotonic working revisions, sealing and required audit are enforced. A durable mutation journal writes revisions and audit before the document. Interrupted transactions replay before the next write. Two-instance concurrency and failure injection before/after every write stage are covered.
4. Publish accepts `{ expectedVersion, nextDoc }` pairs. Restore-style version increments succeed. Stale expectations fail before writes. The seed command and existing tests now use the new API.
5. Added all five publish kinds, full-transaction retry validation and a durable publish journal. Writes retain the required docs → revisions → audit → record → snapshot order. `recoverPublish()` completes interrupted transactions, including a legacy record-ahead-of-snapshot recovery path, without an extra site version or duplicate record. Publish/dashboard middleware recovers lazily on first use and again after API errors. Tests inject failures before and after each of the five writes and the journal write, then retry or recover.
6. Snapshots include `SCHEMA_VERSION`, required published order, schedule bookkeeping and a frozen referenced-media map. Manifests include order and validated revision pointers, including every referenced media record so binary retention has a durable history reference. Snapshot assembly copies data and includes referenced media from published or newly uploaded metadata. The renderer can resolve frozen media even when its metadata is absent from published content. FS media operations refuse deletion or overwrite of binaries retained by publication history, including alternate URL encoding.
7. New revision/audit IDs use fixed-width base32 millisecond prefixes and six random base32 characters. New keys omit timestamps. Revision lookup is doc-scoped, with a bounded legacy-key fallback. Audit queries read months newest-first and stop after satisfying the page. FS listing starts at the requested prefix directory. The 500-revision/20-document lookup test uses one primitive read.
8. FS locks record pid/time/ownership, recover dead or expired owners with a warning, and renew active leases. The planted dead-pid lock test completes within one second.
9. Added draft/publish validation tiers, default text/multiline/richtext lengths, recursive creation defaults and the `createDocument` API service. Publish checks references, media kinds, singleton sections and scheduled data. The admin body limit counts actual bytes up to 1 MiB even with a false Content-Length. The API error boundary returns validation 422 with paths. Store rejection and HTTP dispatch of the rejection are tested.
10. Username indexes use `toLowerCase()`. The existing Playwright configuration already supplies a mkdtemp FS directory and `PW_CHANNEL` defaulting to Chrome, and those settings were retained. Hashed admin assets are exempt from `no-store`, while the SPA shell retains it in local serving and Vercel headers. Added e2e assertions for shell/asset caching and oversized requests.

Additional §18.1 / §18.3 store and config work

- `STORE_DRIVER` accepts only `fs | postgres`. Production bootstrap user/password must be explicit, nonblank values. Local Phil defaults remain, and `.env.example` leaves the password empty with the required comment.
- Schema-driven reference usage prevents trashing documents used by either drafts or published content, returning `in_use`, status 409 and collection/id/title/path usage details.
- Added `Store.deleteExpiredSessions(now)` with expiration, preservation and idempotence coverage. Login/cron invocation belongs to their later implementation phases.

Verification

- `npm ci` — PASS, dependency tree reinstalled, audit reports zero vulnerabilities.
- `npm run build` — PASS, Vite and strict TypeScript.
- `npm test` — PASS, 278 tests plus two hosted-service skips. All eight renderer goldens remain green.
- `npm run check-facts` — PASS, all 122 inventory facts.
- Local HTTP smoke — PASS, fresh FS seed/startup, public HTML/ETag/cache policy, shell `no-store`, cacheable hashed asset and oversized request 413.
- `npm run test:e2e -- --list` — PASS, 11 tests discovered. Browser execution — **not run (sandbox)**. Claude runs the specs using installed Chrome.
- Neon and Blob service tests — **not run (no env)**. Production adapters remain Phase 6 work.
- `git diff --check` — PASS. Public assets, content seed files and golden fixtures have no changes.

Decisions, limitations and later-phase work

- The plan's `effectiveAt` reference points to nonexistent §18.4.4. It is implemented as the optional latest scheduled time incorporated into a snapshot. The Phase 5 scheduler must set it when settling schedules.
- Pre-1b manifests never stored order. Their read compatibility uses order from a matching retained snapshot when available, otherwise a deterministic zero. Exact historical order cannot be reconstructed when it was never stored. New manifests preserve it.
- Authenticated create/publish/dashboard routes remain Phase 4/5 scope. Their creation service, recovery middleware and 422 boundary are implemented and tested with HTTP route fixtures. No end-to-end authenticated publish flow is claimed. Bootstrap creation, login audit/password banners, permission ceilings, cron/login session-GC calls, dashboard broken-reference UI and schedule-aware rendering remain in their assigned phases.
- A transaction journal and renewable lock lease supplement the plan's required write ordering so interrupted FS writes can be resumed safely. Existing legacy revision and snapshot data remain readable.
- No commit, push, deployment, credentials or global configuration changes were made.

## CHANGELOG — Phase 4 — Auth, users, sessions, permissions and audit — 2026-11-09

Shipped

- Added the complete auth API, bootstrap CLI (`npm run bootstrap`), scrypt hashing with the prescribed parameters, timing-safe verification and a dummy verify for unknown users. Bundled 1,000 common passwords with SecLists attribution/license. New passwords enforce the policy; the development Phil/Phil bootstrap remains exempt. Production credentials remain explicitly required by configuration.
- Bootstrap is idempotent and serialized across FS store instances. Added active-user checks, hashed random session IDs, HttpOnly/SameSite cookies, Secure in production, 14-day sliding/30-day absolute expiry, hourly refresh, session listing/revocation, password rotation and credential-generation invalidation. Concurrent refreshes perform at most one write. Login session GC uses an atomic hourly maintenance claim; cron also runs GC.
- Added CSRF and Origin/Sec-Fetch-Site checks, IP login throttling, serialized username failures with doubling lockouts capped at 24 hours, and session API throttling. Successes, failures, lockouts and malformed processed login requests are audited with IP/UA; the local HTTP adapter records the socket peer instead of trusting a caller-supplied proxy header.
- Added a shared role table, pure `can`, permission middleware, user administration with role ceilings, self-role-change prohibition and serialized last-Owner protection. User updates compare the current record before writing; password changes and login bookkeeping cannot overwrite concurrent credentials or roles. Password hashes and CSRF secrets are excluded from public user/session results.
- Added filtered, paginated audit reads and streamed CSV/JSON exports, including CSV formula defanging. The local server now forwards streams instead of buffering the entire response. Added document read endpoints with version ETags, and `passwordWeak`/permissions to auth responses. Dashboard reports weak Owner credentials; lower roles do not receive the private audit feed.

Acceptance and verification

- Phil/Phil returns a session cookie and `passwordWeak: true`; five wrong passwords lock for 15 minutes with failure/lockout audits. Tests cover lockout doubling, IP limits/Retry-After, concurrent refreshes, session rotation/revocation, bootstrap races/idempotence and every role × permission.
- HTTP tests confirm Viewer cannot create, Contributor cannot edit site settings/reorder/publish, Admin cannot create/reset an Owner, and the last active Owner cannot be removed. CSV/JSON export filters and streaming content types pass.
- `npm run bootstrap` against an isolated repository-local FS directory — PASS.
- `npm run build` and `npm test` — PASS with Phase 5 (401 passing tests, two explicit hosted-service skips). `git diff --check` — PASS.

Scope notes

- The login/profile screens and prominent, session-dismissible weak-password banner remain Phase 7a/11 UI work under §18.4. No admin screen or public Admin link was added in these backend phases; `passwordWeak` and the dashboard health finding are ready for those screens. No UI accessibility score is claimed.
- Narrow Store operations were added for auth audit, serialized account changes/bootstrap/lockouts, maintenance claims, hourly session refresh, and sealing working revisions on logout/expiry. They do not restore the removed standalone content-write/revision APIs. The Phase 6 Postgres driver must implement these extensions.

## CHANGELOG — Phase 5 — Revisions, publishing, restore and scheduling — 2026-11-09

Shipped

- Added create/edit/duplicate/trash/untrash/review APIs. Draft writes use `createDoc`/`mutateDoc`, with schema validation/defaults and required audit. Working revisions coalesce for the same author within ten minutes; checkpoints, other authors, elapsed time, logout, publish and restore seal history. Same-millisecond revision ordering uses document versions to avoid selecting an older author revision by random ID order.
- Added schema-labelled field/word diffs (`diff`, already allow-listed), stable-key list added/removed/moved/changed diffs, history pagination/detail, revision restore, pending changes, search, dashboard and JSON content backup.
- Added publish, unpublish, schedule, cancel, rebuild and whole-site restore through kind-tagged `Store.publish` transactions and `recoverPublish`. All publish selections require observed versions; `all: true` also requires the complete versioned selection. Restore is forward-only, restores historical data/order/media via manifest revision pointers, and unpublishes later-created documents while keeping their drafts.
- Added atomic versioned reorder using `mutateDoc`'s `relatedOrder`/`guardVersions` extension and the existing durable mutation journal. Moved documents gain versions, there is one audit and no per-document reorder revision. `publishedOrder` preserves live order until explicitly published; an unrelated publish cannot release a pending reorder. Snapshot arrays are deterministically ordered.
- Schedules freeze data, version and order in the snapshot. Public renders apply due items without cron, ETags include the due schedule set plus the existing time-sensitive representation digest, TTL is capped and SWR disabled around the next scheduled boundary. GET/POST bearer-authenticated cron and Editor+ requests settle due items idempotently, record `effectiveAt`, and preserve newer drafts. Cancellation creates a schedule record. Purge failures return “Live within about 5 minutes”; “Live now” requires a successful purge.
- Authenticated previews/edit renders now use drafts, emit edit annotations only on request and always return `no-store`; public renders do not inspect session cookies. Added referential-integrity error coverage and dashboard broken-reference findings.
- Added SSRF-safe link checking: HTTP(S) only, all DNS answers checked, DNS pinned for the actual connection, private/reserved destinations refused at each of at most three redirects, HEAD/GET fallback, one eight-second deadline, 1 MB response cap and five workers. A real loopback stub receives zero requests; mocked public transports cover redirects, fallback, timeout, size and concurrency.

Acceptance and verification

- Full HTTP lifecycle passes: create → coalesced edit → checkpoint/publish at site version 2 → later edit → revision restore → site restore to version 1 content/order as a new version. Stale saves/publications return 409 with the current document and the reload-and-compare message. Keep-mine is a checkpoint save against the reloaded version; no automatic field merge was added.
- Tests cover scheduled rendering before settlement, conditional requests across the due boundary, TTL/SWR changes, newer-draft preservation, cancellation, idempotent settlement, cron authorization, interrupted publish/reorder recovery, trash usage errors, past events and missing alt text. Existing Phase 1b stage-by-stage failure-injection tests remain green.
- `npm run build` — PASS. `npm test` — PASS: 401 tests, plus two explicit hosted-service skips. All eight public goldens pass; public CSS/JS, seeds, original pages and golden fixtures are unchanged.
- `npm run check-facts` — PASS, all 122 inventory facts. `git diff --check` — PASS.
- Local real HTTP smoke — PASS: login, cookie/CSRF, create, private preview, publish, streamed audit CSV, whole-site restore and logout. The temporary server was stopped.
- `npm run test:e2e -- --list` — PASS, 13 tests across three specs. Added a Phase 4/5 API/preview lifecycle spec at 390px and 1280px. Browser execution — **not run (sandbox)**; Claude must run the installed Chrome outside the sandbox. The actual login/editor/keyboard/compare UI flow remains Phase 7a scope.
- Neon and Blob tests — **not run (no env)**. No hosting credentials, commit, push, deploy or global configuration changes were used.

Scope notes / follow-up

- The §18.1 comparison panel, its Discard mine/Keep mine buttons, password banner and public Admin link remain explicitly unimplemented UI work for Phase 7a. These phases implement their server contracts, schema-aware diff data and permission enforcement; no UI approximation was substituted.
- Unscoped `/revisions/:revId` URLs accept `?docId=...` for the Phase 1b direct lookup; without it the compatibility route searches documents. Clients should supply `docId`.
- Production storage, upload quarantine/real media routes and hosted purge verification stay in Phases 6/10. Link-check tests do not claim connectivity to the club's external sites. Time-expired revisions are sealed lazily on admin activity; no long-lived server timer or extra cron was introduced.
