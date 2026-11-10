# Agent operating guide

Instructions for AI coding agents working in this repository. Read [HANDOFF.md](HANDOFF.md) for how the site is hosted and [docs/admin-manual.md](docs/admin-manual.md) for how volunteers use the admin. `plans/` is development history: `plans/admin-plan.md` (later sections and amendments override earlier ones) and `plans/admin-progress.md` (phase-by-phase verification log). Implemented code and tests take precedence over anything in `plans/`. Read the existing code and tests before editing.

No external services, bots or accounts from the previous owner are needed. The project runs with Node, npm, and for hosting, the maintainer's own Vercel, Neon and Vercel Blob accounts.

## Stack and map

Node 22.x (minimum 22.12), TypeScript strict/ESM, Hono, Preact, `@preact/signals`, preact-iso and Vite. Public pages render HTML on request from a published content snapshot, with small progressive-enhancement scripts. Production stores metadata in Neon Postgres and binaries in a private Vercel Blob store. Local development and tests use filesystem storage. `STORE_DRIVER` accepts only `fs` and `postgres`.

| Path | Responsibility |
| --- | --- |
| `api/{render,admin,shop}.ts` | Three thin Vercel entrypoints exporting `{ fetch(Request) }` |
| `server/http/`, `server/auth/` | Admin API routes, default-deny auth, sessions, CSRF/Origin checks, permissions |
| `server/content/` | Validation, drafts, revisions, publish, schedules, restore, references, health |
| `server/store/` | `Store` interface, Postgres and filesystem adapters, Blob/FS media storage, `postgres-schema.sql` |
| `server/render/`, `server/shop/` | Public templates, caching/purge, media delivery, merchandise catalog and checkout guard |
| `shared/` | Content schema, types, permission table, diffs and stable field paths |
| `admin/src/` | Preact admin SPA: routes, schema-driven forms, shared components, state, token-based styles |
| `content/seed/`, `content/content.md` | Starter content (145 records) and the original facts inventory |
| `public/assets/`, `public/admin/` | Public assets (in Git) and the generated admin build (gitignored) |
| `tests/` | Vitest unit/HTTP/Store/golden/shop/performance suites and Playwright e2e under `tests/e2e/` |
| `scripts/`, `docs/` | Local server, seed/bootstrap/migration/operations commands, volunteer manual and screenshots |

Naming traps: `sponsorsPage` is the singleton page (`/admin/pages/sponsors`); `sponsors` is the collection. Programs and fees are nested sections of the home, recreational and competitive pages, not collections. Media has its own verified upload/replace/edit routes; do not mutate media records through generic document endpoints.

## Commands

Run from the repository root with Node 22.x. Keep hosted credentials (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`) out of the environment for ordinary local work.

```sh
npm ci
cp .env.example .env                 # only if .env does not exist
npm run dev                          # public site + API on :3000, hot-reload admin on :5173/admin/
npm run build                        # Vite build + strict tsc for both TS projects
npm run start                        # built site, admin and API on :3000
npm test                             # check:runtime, then Vitest
npm run check:runtime                # packages and smoke-tests the three functions in plain Node
npm run check-facts                  # checks seed content against content/content.md
npm run test:e2e -- --list           # list Playwright specs without a browser
npm run test:e2e                     # Playwright with installed Google Chrome, outside sandboxes
npm run hash-password                # hidden prompt (or piped stdin), prints a scrypt hash
npm run bootstrap                    # creates ADMIN_BOOTSTRAP_USERS only if the user table is empty
npm run db:migrate                   # applies server/store/postgres-schema.sql; needs DATABASE_URL
npm run seed                         # full content seed: NEW, EMPTY store only
npm run seed:store                   # additive: adds missing merchandise records to an initialized store
npm run seed:media                   # additive: registers missing static media in an initialized store
npm run unlock -- <username>         # audited login-lock reset against the configured store
npm run docs:screenshots -- --list   # manual screenshot inventory, no browser
npm run docs:screenshots             # recapture docs/images/*.png from a local built server
```

Rules for data commands:

- Never run `npm run seed` or `npm run seed -- --force` against a store that has edited content. The seed refuses documents with version > 1 unless forced; `--force` overwrites live edits with repository content. It is for a new, empty database only.
- `seed:store` and `seed:media` are additive, take no arguments, never overwrite or publish existing records, and can be rerun. They require an initialized store with publication history.
- Never put seeds or migrations in the build command. Never run migrations, unlocks or seeds against a target just because credentials happen to be present. Stay inside the task's authorized scope.
- `npm run dev` seeds an empty filesystem store on first start. Without `ADMIN_BOOTSTRAP_USERS`, development falls back to a `Phil` / `Phil` Owner account (`ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD`). Production requires `ADMIN_BOOTSTRAP_USERS`.

Testing notes:

- `npm test` always runs the filesystem suites. Postgres and private Blob suites report **not run (no env)** without `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN`. Never report a skip as a pass.
- Playwright uses installed Google Chrome (`channel: 'chrome'`; override with `PW_CHANNEL`). `npm run test:e2e:install` downloads only the Chromium headless shell, which does not satisfy the default channel. Keep `workers: 1`: specs share one isolated FS server on port 3000, so stop other port-3000 servers first and do not run `docs:screenshots` at the same time. If your environment cannot launch a browser, report browser suites as **not run (sandbox)**.
- Locators: required simple fields render a visible, aria-hidden ` *`, so match by role and exact accessible name, for example `getByRole('textbox', { name: 'Title', exact: true })` or `getByRole('combobox', { name: 'Category', exact: true })`. Scope locators inside nested fieldsets. New-document primary buttons read `Create <thing>` (for example `Create event`), not Save. Wait for loaded UI before typing. Autosave, checkpoints and pending-list reads are asynchronous: await the specific saved version or response, not an older Saved label.

## Change contracts

- TypeScript stays strict with no `any` in `server/` or `shared/`. Server, shared and scripts use NodeNext with explicit `.js` relative imports (including `index.js`). Preserve JSON import attributes and the `includeFiles` runtime assets in `vercel.json`.
- Fields, defaults and validation come from `shared/schema.ts`. Keep stable `_key` identities in nested lists and schema-aware diffs. Reuse existing UI, state and domain helpers before adding new ones.
- All storage access goes through the `Store` and media interfaces; driver-specific behavior belongs in `server/store/`. Every mutation is audited and uses the atomic versioned transaction/journal operations. Preserve retries, expected versions, immutable revisions, publication manifests, scheduled snapshots and retained binaries.
- Admin GET/HEAD handlers must not introduce writes. The documented exceptions (cold initialization, due schedules, 15-minute session refresh, 10-minute maintenance claims, expired health caches) are listed in HANDOFF. Presence uses its own POST. Keep the permission → validation → Store → audit order, CSRF/Origin checks and default-deny authentication.
- Permissions live in `shared/permissions-table.ts` plus `server/permissions.ts` (site/store settings need Editor+, Contributors edit only their own media, Admins cannot manage Admin/Owner accounts, nobody changes their own role or deactivates themselves, the last active Owner is protected). Hiding a control in the SPA is never the enforcement.
- Public goldens in `tests/golden/` are the design arbiter for the eight club pages. Preserve public classes, structure, attributes and assets unless the task explicitly authorizes a change, and never regenerate goldens to hide a regression. `docs/` holds documentation, never generated site output.
- Reuse design tokens: navy `#0B2A5B`, blue `#1D5BD6`, gold `#F2B705`, cream `#FBF8F1`, Barlow Condensed headings, Manrope body. Keep touch targets, focus styles, responsive behavior and accessible names. Sentence-case UI text, no emojis, toast text at most 60 characters.
- **Keep `SHOP_CHECKOUT=disabled`.** `loadConfig` refuses `enabled` unless `NODE_ENV` is `development` or `test`. Store settings cannot override it. Orders, payment, webhooks, email and inventory are unfinished; a catalog edit is not authorization to enable commerce.
- Never commit secrets, password hashes, populated `.env` files, database dumps or screenshots containing real account data. Use generated test credentials. Never log credentials or pass them as shell arguments (`hash-password` reads stdin for this reason).
- Dependencies are limited to the current allow-list without explicit approval. Runtime: `hono`, `@neondatabase/serverless`, `@vercel/blob`, `@vercel/functions`, `diff`, `preact`, `@preact/signals`, `preact-iso`. Dev: `@types/node@^22`, `typescript`, `vite`, `@preact/preset-vite`, `vitest`, `@playwright/test`, `tsx`. Keep current pins and ranges unless the task asks for upgrades.
- Finish a change with `npm run build` and `npm test`, and report changed files, test results, skips, deviations and open issues. If the maintainer keeps the `plans/admin-progress.md` log, append an entry. Do not commit, push or deploy unless the task says so, and confirm which branch you are on first (the handoff was delivered on `main`).
