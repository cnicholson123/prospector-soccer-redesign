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
