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
