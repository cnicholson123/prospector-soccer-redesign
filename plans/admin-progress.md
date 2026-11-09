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

## CHANGELOG — Phase 6 — Production storage adapters — 2026-11-09

Shipped against §18

- Added `PostgresStore` implementing every current Store method, including Phase 1b mutations and guard/reorder extensions, Phase 4 account/bootstrap/login/password/session/maintenance operations, and Phase 5 publication/history/scheduling support. Native relational tables, parameterized queries, an indexed case-insensitive username key, and transaction-scoped cross-instance writer serialization protect CAS, last-Owner and reference checks. No Blob-KV adapter was added; `STORE_DRIVER` remains `fs | postgres`.
- `createDoc`, `mutateDoc` and `publish` commit their entire history/audit/document/snapshot changes in SQL transactions. Publish preserves all five kinds, validates complete manifests/media/order/schedules and supports identical retries. Interrupted SQL transactions roll back; `recoverPublish` returns the last committed version without fabricating a repair or a new publication. SQL triggers enforce immutable sealed revisions and retained audit/publish records.
- Added `postgres-schema.sql`, migration ledger, and transactional/idempotent `scripts/db-migrate.ts` / `npm run db:migrate`. Postgres stores full JSONB envelopes with generated indexed columns to preserve every optional/current field; this extends the plan's illustrative flattened table layout. The migration is explicit, not performed during HTTP requests.
- Added private `VercelBlobs`, retaining FS operation with no credentials. Media metadata stays in Store. The authenticated client-token route issues signed, owner-bound, 15-minute quarantine grants, enforces 60 uploads/hour, and restricts path/MIME/bytes/overwrite. SDK-signed callbacks never create metadata. Local FS has an authenticated raw PUT route with independent byte limits.
- Added server finalization: canonical server-selected paths, bounded downloads, exact size/MIME verification, magic-byte allowlist, intrinsic JPEG/PNG/GIF/WebP dimension checks, PDF signature checks, SVG rejection, verified immutable copies, then metadata/revision/audit creation and quarantine deletion. No supplied URL or dimensions are trusted. Direct generic media creation/edits cannot bypass verification. Added metadata/usage/soft-trash routes and contributor ownership checks.
- Verified media delivery uses the existing render function, preserving the two-function layout. Quarantine never serves; unpublished verified files require a session. Published files use immutable application URLs backed by private Blob reads. Daily cron removes incoming objects older than 24 hours. Verified binaries are retained; destructive binary GC was not added.
- Added `README-deploy.md` for team `chrisbot2026s-projects`, project `prospector-soccer-redesign`: local/hosted env, separate preview storage, migration/seed/bootstrap, deployment commands for later authorized use, full-backup and application/database/content rollback procedures, security and remaining plan gaps. Updated README/env examples and admin CSP for private client uploads.

Acceptance and verification

- Docker successfully ran **PostgreSQL 17** on a free loopback port, with Neon's WebSocket proxy for the allow-listed driver. The same shared contract passes on FS and real Postgres, including concurrency, monotonic history, username collisions, account bookkeeping, rate limits, session refresh/expiry, maintenance claims and atomic reorder.
- Full `npm test` with the disposable Postgres `DATABASE_URL` and test-only WS proxy — **PASS: 438 tests, one Blob no-env skip**. This includes SQL rollback injections after all five publication stages and mutation stages, identical retries, migration reruns and database-enforced history immutability. Test schemas are isolated and removed after each test.
- Existing Phase 4/5 auth and content HTTP suites additionally ran with `POSTGRES_HTTP_TESTS=1` — **PASS: 109 tests**, including the full create/edit/publish/schedule/restore/reorder lifecycle and role/session protections. The longer hosted-test timeout is enabled only when `DATABASE_URL` exists.
- Default `npm test` without service env — **PASS: 413 tests, 11 explicit hosted-test skips**. `npm run build` — **PASS**. All eight public golden tests pass; public CSS/JS, seeds, original pages and golden fixtures are unchanged. `npm run check-facts` — **PASS: 122 facts**. `npm audit --omit=dev` — **PASS: zero vulnerabilities**. Blob is pinned to 2.4.0 (private-storage capable); the newest available version introduced a vulnerable transitive dependency during evaluation.
- Real local HTTP smoke — **PASS**: public HTML, login, raw upload, quarantine denial, finalization, draft denial, publication and public binary delivery. Temporary server stopped.
- `npm run test:e2e -- --list` — **PASS: 14 tests in four specs**. Added Phase 6 real-HTTP quarantine/upload/finalize/publish coverage. Browser execution — **not run (sandbox)**; Claude must run with installed Chrome.
- Real Neon cloud contract — **not run (no env)**. Real private Blob service test — **not run (no env)**. A mock SDK test verifies private/immutable options and scoped token constraints, but is not claimed as a hosted-service pass. Vercel preview/production deployment, hosted purge and cron delivery — **not run (no credentials; deployment not authorized)**.

Deviations / open issues

- §18 overrides the old Phase 6 Blob-only acceptance: no Blob metadata driver and no `STORE_DRIVER=blob` lifecycle. The Postgres transaction counterpart to KV stage-failure recovery is rollback plus identical retry; partial committed publish state is not a valid SQL state.
- Original images/PDFs are verified and stored; `web` currently points to the verified original. Client resize/WebP generation, true alternate variants, replacement/dropzone/picker UI and focal-point UI remain Phase 10. No ≤2000px conversion, antivirus scanning or complete image/PDF decoding is claimed.
- The deliberate whole-store advisory writer lock favors correctness for a small CMS over write throughput. JSONB envelopes retain exact ISO strings with indexed generated fields, rather than independently mutable copies of every field. Existing local edited FS data/history are not automatically imported into Postgres; initial seed and bootstrap target an empty database.
- The Phase 7a UI, Admin link, prominent weak-password banner, later admin screens, browser/accessibility acceptance and Phase 12 legacy cleanup remain outstanding. The runbook identifies these gaps and does not claim the placeholder UI is production-ready.
- No commit, push, deployment, hosting credential acquisition, global configuration edit, or public design change was made. Disposable Docker containers are stopped after verification.

## CHANGELOG — Phase 6b — Security remediation — 2026-11-09

Shipped against `plans/reviews/2026-11-09-security-remediation.md`

- **A3:** Added `Store.capturePublication()` under the FS writer lock / Postgres transaction so document envelopes and the original snapshot generation travel together into commit. All publication paths preserve that generation. Both adapters reject changed envelopes without a version increment; publish, unpublish, schedule, cancellation, settlement and implicit media publication advance versions. Stale rebuild regression proves an intervening unpublish cannot be undone.
- **A4:** Published membership survives soft trash until that document is explicitly selected for removal. Rebuilds, schedules and unrelated publications retain it. Manifest validation recognizes retained published envelopes; the publication audit includes every changed envelope, including automatically published media.
- **A5:** Draft, published and frozen scheduled references participate in the same locked/transactional trash check, including the scheduled target itself. Added a schedule-versus-trash race regression. Failed lazy settlement becomes a dashboard `schedule_failed` issue; auth/logout, cancellation, untrash and repair routes remain usable.
- **A6:** Generic media revision restore is denied. Approved media metadata edits continue through the ownership-checked media endpoint.
- **A7 / F-L1:** Added audited `Store.revokeSessions()` for single, other-session and logout revocation. FS writes the audit, a single atomic bulk-revocation marker, optional sealed revisions and physical cleanup through its replay journal; a crash between deletions cannot leave a subset of the selected sessions valid. Postgres commits or rolls back all changes in one transaction. User rename/index cleanup now uses the FS journal; credential/role changes revoke sessions within the same user mutation. Failure injection covers audit writes, deletes, user/index writes and SQL rollback.
- **A8:** Implemented the review's explicit partial-success option: restore-and-publish returns its committed `doc`, `published:false` and a separate `publishError` if publication fails. Successful results include `published:true` and the publication details. This contract is documented for the later UI.
- **A9 / M4:** CSRF and cron compare UTF-8 buffer lengths before constant-time comparison. Invalid audit/revision cursors return 422, including streamed-export validation before headers. Non-Error throws are normalized and handled without leaking their values.
- **F-H1 / F-H2:** Login lockouts are per username/IP, with the original doubling duration and a slower 100-failure/15-minute username throttle. Correct credentials from a non-offending IP bypass that username throttle. Added audited `npm run unlock -- <username>` using a lock-generation change; the shared IP throttle intentionally remains. Audit only the first failure per IP/window and pair lock transitions, counting suppressed repeats in persistent rate records. FS audit pagination reads individual rows up to the requested page rather than loading a whole month; SQL retains database-side pagination.
- **F-H3:** Working saves coalesce only into `edited` revisions. Original `created` and `duplicated` revisions are retained and sealed on the first subsequent edit. Duplication now has its own revision/audit action. Both originals remain restorable.
- **F-M1 / F-M2 / F-M3:** One default-deny authentication middleware protects every admin route, including future routes. Exemptions are login, healthz and cron handlers with their own credentials. Blob's signed completion callback moved to `/api/admin/cron/blob-upload`; token requests remain session-protected. Weak-Owner health findings are visible only to `users.manage` users or that Owner. Login usernames use the creation regex; document IDs use the prescribed 64-character grammar; encoded FS key segments reserve the `.json` suffix within the 200-byte cap. Invalid identifiers return 4xx before creating a recovery journal.
- **Bootstrap policy / F-L2 / F-L3 / F-L4:** Added boolean `ADMIN_FORCE_PASSWORD_CHANGE`, default true in production and false in dev/test. A weak bootstrap account is restricted to me/password/logout until its password changes; private preview also enforces this. With the flag false the advisory weakness API/health state is preserved. Current-password attempts are capped at 10/15 minutes per user. Documented trusted Vercel ingress/XFF handling and local socket-peer behavior. Production cookies now use `__Host-psc_session` with Secure, Path=/ and no Domain; local cookies keep their development name.

Verification

- `npm run build` — PASS (Vite and strict TypeScript).
- `npm test` without hosting/service env — PASS: **445 tests**, 17 explicit skipped tests for Postgres/Blob. All eight public goldens pass.
- Docker **PostgreSQL 17.11**, through the existing Neon WebSocket test proxy: `DATABASE_URL=… POSTGRES_TEST_WS_PROXY=… npm test` — PASS: **476 tests**, one Blob no-env skip. The shared Store contract, SQL rollback tests and new security transaction/race tests run on both adapters.
- `DATABASE_URL=… POSTGRES_TEST_WS_PROXY=… POSTGRES_HTTP_TESTS=1 npx vitest run tests/unit/auth.test.ts tests/unit/content-engine.test.ts tests/unit/security-remediation.test.ts` — PASS: **131 tests**. The final scheduled-target check was additionally re-run in the Postgres security suite after that run.
- Regression sensitivity: an isolated, unmodified pre-fix `HEAD` checkout with the new HTTP regression cases failed **15/15** selected cases. A separate original-API stale-rebuild reproduction failed by resurrecting the unpublished document. These intentional failures are recorded only in ignored local test logs.
- `npm run bootstrap` then `npm run unlock -- Phil` against an isolated repository-local FS directory — PASS; unlock writes the audit record.
- `npm run check-facts` — PASS, 122 inventory facts. `git diff --check` — PASS. Public CSS/JS, seed content, original pages and golden fixtures have no changes.
- `npm run test:e2e -- --list` — PASS, **15 tests in five specs**. Added security HTTP/history/membership assertions and refreshed the existing lifecycle's post-publication version. Browser execution — **not run (sandbox)**; Claude runs installed Chrome afterwards.
- Real Neon cloud, real private Blob, hosted purge/cron and deployments — **not run (no env)**. Docker PostgreSQL is not claimed as a real Neon service test. Disposable task containers are stopped after verification.

Deviations / open issues

- Used the expressly permitted separate-publish-error contract for A8 rather than combining draft restore and publish in one transaction. Clients must check `published`/`publishError`; the later admin UI must not show a publication-success toast on a partial result.
- The admin SPA remains the existing Phase 0 placeholder. The prominent persistent, session-dismissible weak-password **banner UI** and profile screen remain Phase 7a/11 work, as previously recorded; this phase implements and tests the enforcement/advisory server contracts and health visibility, not a substitute login/profile UI. No public Admin link or design change was added.
- Signed Blob callbacks now have a dedicated cron-namespace URL to preserve the review's exact default-auth exemptions. This is SDK-configured and covered by mocked token/signature tests; a real Blob callback is not claimed without credentials.
- Production cookie renaming signs out any pre-6b browser session using the former cookie name. No existing account is automatically rewritten by a later change to the bootstrap-only force-password flag.
- No commit, push, deployment, hosting credentials, global configuration change or persistent change outside the repository was made. Temporary editing helpers initially created under `/tmp` were moved into the repository's ignored cache and removed from `/tmp`.

## CHANGELOG — Section 19 — Hashed multi-user bootstrap — 2026-11-09

Shipped

- Added secret `ADMIN_BOOTSTRAP_USERS` configuration with canonical scrypt hashes, bounded arrays, case-insensitive duplicate detection, validated usernames/display names/roles, and an Owner requirement. Production requires this hashed configuration. The local single-user fallback supports `ADMIN_BOOTSTRAP_USERNAME`, the earlier `ADMIN_BOOTSTRAP_USER` alias, and `ADMIN_BOOTSTRAP_PASSWORD`.
- Added `Store.bootstrapUsers` to both adapters. Missing users are created under the existing writer lock/SQL transaction, with a separate `system.bootstrap` audit for each creation. Existing credentials, roles, account status and names remain intact. FS per-account journals allow interrupted runs to resume safely. The earlier single-user Store method remains for its existing callers.
- Added `npm run hash-password` / `scripts/hash-password.ts`. It consumes stdin, disables terminal echo for interactive input, restores terminal mode, bounds input, never accepts a command-line password, prints only the scrypt hash to stdout, and uses generic input errors. Production guidance explicitly sets `ADMIN_FORCE_PASSWORD_CHANGE=false`; false is now also the default in every environment.
- Configured Playwright's isolated FS server with generated credentials and hashes for Phil and Chris (Owners), plus a generated short-password reminder fixture. New unit tests also generate passwords. No real password or credential was introduced into source, examples, logs or test fixtures.

Verification

- `npm run build` — PASS. `npm test` — PASS with the Phase 7a changes, 453 tests and 17 hosted-service skips. Tests cover concurrent/idempotent bootstrap, preservation of existing accounts, later missing-account creation, secret-free audit/config errors, canonical hash validation, generated-password login and the stdin hashing CLI. The shared bootstrap contract is included for FS and for Postgres when an environment is supplied.
- Local real HTTP smoke — PASS for both configured Owners, authenticated APIs and the content lifecycle. No password appeared in child-process logs.
- Real Neon/Postgres and private Blob services — **not run (no env)**. No database container, credential acquisition or deployment was attempted in this run.

Decisions / compatibility

- An explicit old `mustChangePassword` account flag is retained when bootstrap re-runs, as required by the no-overwrite rule. Existing opt-in enforcement remains compatible; new Section 19 hashed accounts have no forced change. Hash strength cannot be determined without plaintext; login re-evaluates weakness and the UI advises accordingly.

## CHANGELOG — Phase 7a — Events vertical slice — 2026-11-09

Shipped against §18.4 and the expanded dashboard request

- Replaced the placeholder with the Preact/TypeScript admin SPA. It has a navy sidebar, gold active markers, cream canvas, white cards, Barlow Condensed headings, Manrope body, a top bar and phone bottom navigation. Only Dashboard, Events and Profile navigation is exposed in this slice.
- Added the public utility-bar Admin link before the social icons, with the existing key SVG and all-width styling. The local sign-in hint enables the specified “Edit this page” link; page editors are still Phase 7b and that route explicitly identifies the upcoming workspace. Original public markup/styles/assets are retained except these authorized entry-link additions. All public golden fixtures are unchanged.
- Added login with labelled/autocomplete fields, show/hide password, Caps Lock feedback, inline failures, lockout countdown and back-to-site navigation. Cookie-backed session loading and a same-origin CSRF client drive every API write. The optional weak-password banner is persistent across screens, dismissible per browser session, and links to a working password-change form.
- Dashboard displays pending, scheduled and review counts, health findings and the last 15 permitted audit entries. Event/profile health findings link to their screens; findings requiring later-phase editors are identified without inventing those editors. Events list supports search, type/status filters, date/title sorting, status pills and an empty state.
- Added the generic schema-driven form for every field type used by Events: text, select, date, time, URL, constrained rich text with formatting/preview, and boolean. It shares validation and rich-text rendering with the server. The editor provides field errors, autosave after 1.5 seconds and on blur/navigation, serialized in-flight saves, retry/backoff, per-user/document local recovery, navigation/unload protection and explicit checkpoints. Native input undo remains available. A 409 preserves the local draft and shows schema-aware side-by-side comparison with Discard mine / Keep mine; keep-mine retries at the returned version as a new checkpoint.
- Added draft preview with true 390/820/1280 viewports scaled to the available pane, explicit device controls and open-in-new-tab. A development-only same-origin Vite preview proxy preserves the existing frame CSP while using the :3000 renderer. Preview refreshes on saved versions. Phone editor panels switch between the form, preview and history.
- Added the global publish tray with collection groups, versioned selections, field/word comparisons, optional notes, stale-selection reload, read-only presentation for non-publishers and accurate purge-result copy. “View live” includes the returned site version.
- Added document History with paginated revisions, authors/times/actions/summaries, schema/word diffs, explicit restore confirmation, version-checked draft restore, then ordinary publication. Restore does not claim automatic publication or hide partial-success contracts.
- Added Playwright's full create/edit/preview/publish/public-verification/restore/republish flow at 390px and 1280px, plus a 1280px keyboard-only pass, login layout screenshots, and optional reminder coverage. The flow publishes the changed title before restoring, so the final public assertion verifies a real content change.

Verification / remaining acceptance gates

- `npm run build` — PASS, including strict TypeScript. `npm test` — PASS, **453 tests**, 17 explicit hosted-service skips. All eight public golden comparisons pass. New client-state tests verify in-flight keystroke preservation, versioned conflict overwrite, recovery gating and schema validation.
- `npm run check-facts` — PASS, 122 inventory facts. `git diff --check` — PASS.
- Real local HTTP smoke — PASS for public Admin markup, built SPA deep links, generated multi-user login, create/edit, private preview, publication, earlier-revision restore, republish/public content and dashboard health/activity.
- `npm run test:e2e -- --list` — PASS, **19 tests in six specs**. Browser execution — **not run (sandbox)**. Chrome must run these specs afterwards. Visual browser QA and Lighthouse login/editor accessibility scores (required threshold ≥95) — **not run (sandbox)**; no score or browser acceptance pass is claimed.
- Real Neon/Postgres and private Blob — **not run (no env)**. Later-phase work has not started; the browser acceptance gate for Phase 7b remains open.

Scope / open issues

- Remaining collection/page editors, full media/profile/session administration, bulk/trash/reordering UI, scheduling UI, site-wide history/audit screens, inline editing and the command palette remain in their assigned later phases. No additional dependency was added.
- Existing must-change flags are honored for compatibility. Production bootstrap guidance and all new hashed accounts use optional password changes.
- No commit, push, deployment, global configuration edit or persistent edit outside this repository was made. Real account secrets must still be supplied through the deployment environment when hosting is authorized.

## CHANGELOG — Phase 7b — Breadth editors and 7a polish — 2026-11-09

Shipped against §18.4 and §8

- Generalized the Events editor, autosave/recovery state, conflict comparison, preview and revision timeline for every editable content type. All nine singletons (site settings and eight pages) now have working editors; page/settings sections use accordions. The existing `sponsorsPage` singleton continues to use `/admin/pages/sponsors` while the collection uses `/admin/sponsors`.
- Extended the schema-driven form with nested objects, links, money/ranges, numbers, percentages, months, icons, Pacific-time datetime windows, searchable single/multiple references and repeatable lists. Lists support collapse, meaningful row titles, add/remove, duplication with fresh nested stable keys, pointer drag, Alt+arrow reordering and explicit up/down buttons. Constrained Markdown toolbars and previews respect inline fields. Existing media references/alt text remain visible; media selection/upload is explicitly reserved for Phase 10.
- Added the Pages index, Home and every public-page editor, Site settings, callouts/announcements with activation windows, teams/coaches, results, board members, sponsors, sponsor tiers, link-mode documents and FAQs. Programs, recreational fees, competitive costs and coaching programs are edited within their existing singleton sections, with navigation shortcuts. No alternate collections or duplicated content were introduced.
- Every collection, including Events, has search, status and schema-based category/type filters, sorting, status pills, selection/bulk publish, trash/restore, duplicate, preview and history links. Orderable collections use versioned atomic reorder and have keyboard/pointer controls. Trash uses the existing versioned integrity endpoint; refusals show the actual usage list with editor links. Bulk operations report partial completion if a later item is refused. Trash and reorder offer version-checked Undo. Published trash entries are explicitly selected for removal through the publish tray.
- The shared publish tray now handles all collections/singletons, accepts collection selections, uses schema-aware titles and links View live to the relevant public page. Moved the existing field/list/word diff algorithm into a browser-safe shared module, retaining the server export and semantic equality behavior.
- Navigation is grouped into Content / Club / Library / Settings, with live counts from the dashboard response and a phone navigation dialog. The sidebar background is painted for the full document height; its navigation scrolls within the viewport. The skip link is offscreen until keyboard focus.
- Recent activity uses relative times with full timestamps on hover, readable action verbs and publication counts, and collapses consecutive system/seed/migration entries. Content health links now reach the new editors. Missing-alt checks exempt known static favicon, touch-icon and crest assets; uploaded/content images remain checked. The seed's `hero.jpg` missing-alt finding remains intentionally visible.
- Added `tests/e2e/admin-breadth.spec.ts`: edit/publish a board member, sponsor and page-copy field, verify the corresponding public pages, preview/history and overflow at 390px and 1280px; additionally exercise in-use trash refusal, bulk selection and keyboard reorder/Undo. The spec restores the isolated FS site's starting version so later public golden checks retain their fixture.

Verification

- `npm run build` — **PASS**, Vite and strict TypeScript.
- `npm test` — **PASS: 462 tests**, 17 explicit hosted-service skips. All eight public golden tests pass. New regressions cover every editor's collection routing, nested autosave, keyed nested duplication/diffs, reference/page routes, Pacific windows, activity grouping/verbs, missing-alt exemptions, board/sponsor/page publication and public rendering, and duplicate/trash/restore across every editable collection.
- Real localhost FS smoke — **PASS**: generated-password login, board/sponsor/page writes, private previews, publication/public HTML, built SPA deep links and navigation counts. The temporary server was stopped and its data directory removed.
- `npm run check-facts` — **PASS: 122 facts**. `git diff --check` — **PASS**. Public assets, legacy pages, seeds, golden fixtures, dependency manifest and lockfile are unchanged.
- `npm run test:e2e -- --list` — **PASS: 22 tests in seven specs**. Playwright browser execution — **not run (sandbox)**. Visual browser acceptance and Lighthouse accessibility ≥95 — **not run (sandbox)**; Claude must execute with installed Chrome. No browser/a11y pass is claimed.
- Real Neon/Postgres and private Blob service tests — **not run (no env)**. Everything executed here used the filesystem driver; no hosted service, credential acquisition or deployment was attempted.

Decisions / open acceptance gates

- Chris explicitly requested Phase 7b while the recorded Phase 7a browser gate remained open. Implementation proceeded under that instruction; the outstanding 7a/7b browser and accessibility gates are still reported above.
- Media picker/upload, publish scheduling and inline editing, site-wide history/audit, and later role/review/palette work remain in their assigned phases. Documents expose link mode in this phase. Singletons intentionally have no duplicate/trash operations, consistent with their schema and server contract.
- No commit, push, deployment, global configuration edit or edit outside this repository was made. No dependencies were added.

## CHANGELOG — Phase 7b fix-up, including Phase 7a regressions — 2026-11-09

Shipped

- Reviewed and retained the interrupted Phase 7b editors, forms, collection actions, public-render integration and existing tests. Read all six failure contexts and inspected the 19 supplied screenshots. Recorded each failure's classification, root cause and fix in §20 of `plans/admin-plan.md`. No trace archives were present in the supplied directory.
- Fixed the editor's publication/navigation flush to wait for an in-flight checkpoint even when its draft is clean. Kept the publish tray's version checks and explicit conflict reload behavior. Fixed background refreshes so delayed reads cannot replace a newer saved version, a local edit or a disposed editor. Other-editor notices remain available for dirty drafts.
- Preserved stable accessible navigation names by hiding count badges from the accessibility name. Added meaningful unnamed-team labels. Corrected the reorder spec to await loaded rows and verify exact swaps/Undo by stable editor URLs.
- Classified the missing reminder as test isolation. The failed snapshot shows a rate-limited login. Added a shared e2e fixture that resets only the isolated FS store's localhost login-attempt buckets before each test. The application still enforces its existing ten-attempt IP limit. Added successful-login checks before the reminder assertions.
- Classified the intermittent bootstrap failure as a scheduling assumption in the test. Concurrent FS lock acquisition has no caller-order guarantee. The assertion now requires exactly one creator, while retaining credential/role preservation and exactly-once audit checks.
- Added state and component-effect regressions for refresh/save overlap, local keystrokes, disposal, clean checkpoint flush, stable counted navigation and reminder dismissal. The event e2e flow additionally checks the saved Location through the API. Both admin UI suites close their pages before restoring the seed publication, preventing their successful edits from contaminating later public comparisons.

Verification

- `npm run build` — **PASS**, Vite and strict TypeScript.
- `npm test` — **PASS**, **468 tests**, 17 hosted-service skips. All eight public golden comparisons pass. The suite uses the filesystem driver without hosting credentials.
- Bootstrap concurrency case — **PASS, 20 consecutive runs** with concurrent calls and the original preservation/audit assertions.
- Regression sensitivity — removing the new refresh protections and restoring the early-return flush reproduced **three failing regression tests**. Restored the fixes afterwards.
- `npm run test:e2e -- --list` — **PASS**, 22 tests in seven specs. Browser execution and Lighthouse accessibility scores — **not run (sandbox)**. Claude must rerun with installed Chrome before the 7a/7b browser gates can close.
- `npm run check-facts` — **PASS**, 122 facts. `git diff --check` — **PASS**. Public assets, seeds, golden fixtures, dependency manifest and lockfile remain unchanged.
- Real Neon/Postgres and Blob checks — **not run (no env)**.

Decisions / open issues

- Used focused unit/component-effect checks and supplied artifacts because browser launch is prohibited. These checks establish the covered state transitions and component contracts. Visual layout, actual browser keyboard/focus behavior and Lighthouse ≥95 remain unverified in this run.
- Kept the inherited Phase 7b scope and its existing deferred media, scheduling, inline-edit and later administration work. No dependencies were added.
- No commit, push, deployment, global configuration change or edit outside this repository was made.

## 7b browser verification (Claude, 2026-11-09)
- Ran all 22 Playwright specs in real Chrome. Fixed: autosave false 409 after another user's publish bumped the version without changing the draft (editor now rebases silently when `current.draft` equals the base draft); keyboard spec targeted the out-of-order header "Save checkpoint" button (now the footer one). Playwright already runs with `workers: 1` (specs share one server/DATA_DIR); the earlier parallel failures came from a `--workers=3` CLI override.
- Open for Phase 8: the publish tray must handle a 409 from a concurrent edit gracefully (explain, refresh pending list, let the user retry) instead of leaving the dialog open silently.

## CHANGELOG — Deployment hotfix — Node ESM packaging — 2026-11-09

Shipped against the deployment hotfix acceptance criteria

- Switched the root TypeScript configuration for API, server, shared modules, scripts and tests to `module` and `moduleResolution` `NodeNext`. Added `admin/tsconfig.json` with Bundler resolution, checked explicitly by the build. Converted all relative TypeScript module specifiers to `.js`, including directory `/index.js`, re-exports, dynamic imports and type-only imports. Admin imports also use explicit specifiers because the NodeNext tests import its component/state modules. Vite resolves these references to the original TypeScript sources.
- Audited filesystem reads reachable from both function entrypoints. Their bundled asset is `server/auth/common-passwords.json`, now explicitly included for each function through `vercel.json`. Its static import already uses JSON attributes. Added the missing attribute to the auth test's JSON import. Templates are compiled modules. Seed JSON and migration SQL are read only by the corresponding CLI scripts. Static public files are served separately, and FS document/media/lock reads use runtime `DATA_DIR`.
- Added `tsconfig.runtime.json`, `scripts/check-runtime.mjs` and `tests/runtime-smoke.ts`. `npm run check:runtime` compiles unbundled ESM with `tsc`, imports both emitted entrypoints with plain Node, and seeds an isolated temporary FS store through the compiled seed CLI. It then constructs separate function packages containing emitted JS and each function's declared assets, omitting tsc's automatic JSON copies. Each package passes Web Requests through the default `{ fetch }` exports for health 200, home `?page=index` 200 HTML and wrong-password login 401. Child processes have no TypeScript loader and run from the packaged directory. Temporary packages and generated credentials are cleaned up. `npm test` now runs this check before Vitest.

Verification

- Before changing the existing imports or compiler configuration, the new check failed with `ERR_MODULE_NOT_FOUND` for emitted `api/admin.js` importing extensionless `server/http/hono-app`, reproducing the deployed startup failure.
- `npm run check:runtime` — PASS on Node 22.12.0 and 25.9.0. Removing either function's `includeFiles` declaration in turn makes the check fail on missing `common-passwords.json`. Both declarations were restored after these negative checks.
- `npm run build` and `npm test` — PASS on Node 22.12.0 and 25.9.0. Vitest reports 468 passed and 17 hosted-service skips. All eight public golden comparisons pass.
- TypeScript AST audit — PASS across 749 module references. No extensionless relative imports, bare `require`, `__dirname`, `__filename` or JSON imports missing attributes remain in the checked application, scripts, tests and configs.
- `npm run check-facts` — PASS, 122 facts. `npm run test:e2e -- --list` — PASS, 22 tests in seven specs. Existing e2e imports were updated for NodeNext. Browser execution and Lighthouse — **not run (sandbox)**.
- Real Neon/Postgres and private Blob tests — **not run (no env)**. Executed application tests use the FS driver. Public assets, content seeds, goldens and the dependency lockfile have no changes. `git diff --check` — PASS.

Decisions / open issues

- This is the requested packaging hotfix. The Web-standard handler contracts and existing content, auth, UI and storage behavior are preserved. No dependencies were added.
- The packaging check models per-file compilation and declared assets locally. Vercel deployment verification remains pending. Node 22.12 emits an experimental warning for its built-in filesystem glob API, which completes successfully.
- The existing Phase 8 publish-tray follow-up remains open. No commit, push, deployment, hosting credential acquisition, global configuration edit or edit outside the repository was performed.

## CHANGELOG — Phase 8 — Preview, publishing, scheduling and inline editing — 2026-11-09

Shipped against §8 / §14 with §18 amendments

- Retained the 7a/7b editors, section accordions, autosave/recovery, history and version checks. The device preview still renders real pages at 390/820/1280px; focusing a form field now scrolls to and outlines its matching annotation, including stable-key list fields. Open-in-new-tab stays a private draft preview. Editors have a versioned View live link and an Edit on page workspace.
- Extended the global PublishTray across all saved pending documents with collection groups, visible per-item before/after summaries, expandable schema/word diffs, individual and all/none selection, optional notes and field-validation links. Published trash remains an explicit removal. Added a keyboard-accessible split button for publish now, schedule and request review; Contributors get review requests and private previews, while Viewers get read-only differences.
- Added Pacific date/time scheduling through the existing versioned schedule transaction. The UI rejects past times and nonexistent spring-forward times, explains the frozen saved-version behavior, displays existing schedule times and supports version-checked cancellation. Schedule notes now reach the publish record and sealed scheduled revision. Render-time activation, cache/ETag boundaries and lazy/cron settlement remain the existing engine; no timer service or extra dependency was introduced.
- Added `public/assets/js/admin-inline.js` and edit-only styling on the real public templates. Annotated plain text edits in place with `contenteditable="plaintext-only"`, plain-text paste, keyboard activation, Enter/blur commit, Escape restore and 1.5-second autosave. Other types open the existing schema control in a side popover. The parent checks exact origin, source window, permissions and schema paths; stable list keys resolve against the current draft. Shared page/collection fields use separate instances of the same EditorState, including CSRF writes, validation, recovery, conflict comparison, revision/audit, queued flush and navigation/unload protection. A failed document read cannot accidentally become a create. Main-page state is reused rather than duplicated.
- Authenticated edit responses remain no-store and now explicitly restrict script/connect origins, forms, base URLs and same-origin framing. The bridge and CSS load only with edit annotations; ordinary public HTML has no editor assets or metadata. All original public assets and all golden fixtures are unchanged.
- Addressed Claude's required concurrent-publication failure: any publish/schedule 409 displays “Someone else saved changes while you were reviewing,” explains that nothing was published/scheduled, automatically refreshes pending data, clears stale selection, preserves notes/date and requires a newly reviewed selection before retry. A failed refresh stays visibly actionable and cannot publish old selections. Review requests report partial completion separately. Purge-result copy retains §18's five-minute fallback, and successful publication links include `?v=`.
- Added five Playwright scenarios: inline home lead → autosaved pending change → publish → versioned live page at 390px and 1280px (also field outline and rich-text popover); Pacific schedule → not visible → due/settle → visible; two independent editor sessions causing a real publish 409 then reviewed retry; Contributor preview/review and Viewer read-only tray. The specs retain isolated FS data and restore the seed publication after closing editing pages.

Verification

- `npm run build` — **PASS**, Vite and both strict TypeScript configurations.
- `npm test` — **PASS: 477 tests**, 17 explicit hosted-service skips; all eight public golden comparisons pass. This includes the unbundled plain-Node `npm run check:runtime` packaging/import smoke for both function entrypoints, with explicit `.js` imports retained.
- Added focused parent/child bridge, permission, stable-path, failed-load, conflict refresh/retry and refresh-failure tests, plus FS HTTP coverage of revision/audit/pending/publication, exact edit headers, every real page annotation, schedule notes/frozen activation/settlement and Contributor authorization.
- Two existing complete FS lifecycle cases intermittently exceeded their old five-second limit during full-suite concurrent disk writes. Their limits are now 15 seconds (the existing hosted 60-second allowance is retained); all lifecycle assertions remain unchanged. No application concurrency checks were relaxed.
- `npm run check-facts` — **PASS**, all 122 inventory facts. `git diff --check` — **PASS**.
- `npm run test:e2e -- --list` — **PASS**, 27 tests across eight specs. Browser execution, actual focus/visual QA and Lighthouse accessibility scores — **not run (sandbox)**. Claude must run the installed Chrome afterwards; browser acceptance is not claimed here.
- Real Neon/Postgres and private Blob service tests — **not run (no env)**. Executed application tests use the filesystem store. No hosted credentials, deployment, commit or push was attempted.

Scope / remaining gates

- No Phase 8 implementation was deferred. Image/file popovers intentionally reuse the current 7b reference/alt controls; media selection/upload remains Phase 10, as specified by the earlier phase split. The full review-approval dashboard and user administration remain Phase 11.
- Public design is unchanged outside the explicit private edit-mode controls. Browser accessibility and responsive appearance remain acceptance gates until Claude runs the specs. No dependencies, package/lockfile, global configuration or files outside this repository were changed.
