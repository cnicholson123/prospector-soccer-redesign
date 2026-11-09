<img src="public/assets/img/crest-sm.png" width="64" alt="">

# Prospector Soccer Club

A mobile-friendly website and content management system for Prospector Soccer Club in Cameron Park, Shingle Springs and Rescue, California. It includes club/program information, events, teams, sponsors, a document library, and a browsable merchandise proof of concept. The current content identifies the site as a redesign concept. Images are illustrative. Search indexing and checkout are disabled by default.

## Architecture and source map

Public pages render HTML on request from a published content snapshot. Visitors receive the club content without JavaScript. Small scripts enhance navigation, filters, event dates, the season dial and the shop cart. Publishing updates the snapshot without rebuilding the application.

| Location | Responsibility |
| --- | --- |
| `api/render.ts` | Public HTML, crawler endpoints, authenticated draft previews and private-media delivery |
| `api/admin.ts` | Hono admin API for authentication, content, publication, media and account management |
| `api/shop.ts` | Shop catalog/cart API and disabled checkout boundary |
| `server/render/` | Escaped HTML templates, constrained Markdown, snapshot views and CDN caching |
| `server/content/`, `server/auth/`, `server/http/` | Content transactions, revisions, authorization, sessions and routes |
| `server/store/` | Shared `Store` interface, Postgres adapter, filesystem KV adapter and media storage |
| `shared/` | Content schema, types, permission table and shared diff/validation helpers |
| `admin/` | Preact + TypeScript SPA, Vite, signals and schema-driven forms |
| `public/assets/` | Public CSS, scripts, images and private-preview bridge |
| `public/admin/` | Generated admin build, gitignored |
| `content/seed/` | Structured initial content and static-media records |
| `content/content.md` | Original club-facts inventory used by the facts check |
| `tests/golden/` | Eight retained public HTML reference fixtures |
| `scripts/` | Local server, seed/bootstrap, migration, runtime and operations commands |

All three Vercel functions default-export `{ fetch(Request) }`. Keep explicit `.js` relative imports in TypeScript for unbundled Node ESM deployment. `npm run check:runtime` compiles and exercises isolated function packages with their declared assets.

Production uses Neon Postgres for documents, users, sessions, revisions, publications and audit. Private Vercel Blob stores verified media binaries. The renderer serves authorized application media URLs, so storage credentials stay server-side. Local development uses the same `Store` contract through filesystem metadata and binaries under `DATA_DIR`. Postgres mutations use transactions and version checks. Filesystem writes use a renewable cross-process lock and replay journals, with the published snapshot committed last. Interrupted writes recover through the Store API.

`shared/schema.ts` defines singleton pages/settings and collections such as events, teams, board members, sponsors, documents, FAQs, media, products, bundles and categories. The sponsors page singleton is `sponsorsPage`, distinct from the `sponsors` collection. Fields drive forms and validation, with stable `_key` values in lists. Rich text supports a constrained Markdown subset and escapes HTML.

Each document has a draft, optional published copy, version and status. Autosave updates a working revision. Checkpoints, publication and other editing boundaries seal revisions. Saving requires the version the editor read. A conflict keeps both copies for comparison and explicit Discard mine / Keep mine choices. Publication validates a versioned selection, seals history, appends an audit and publication manifest, and builds a complete snapshot with frozen media references. Scheduled publication freezes the selected content and takes effect at render time, with cron/admin activity recording settlement later.

Public responses use ETags and CDN caching. Publishing attempts a content-tag purge. When purge fails, the UI reports the cache delay, and View live uses a versioned URL. Preview/edit responses require a session and use `no-store`. Warm admin reads have query/write budgets in the performance tests. Due schedules, maintenance and cache refreshes can write.

## Local development

Use **Node 22.12+ within Node 22.x**, as selected by `package.json`, and npm. Run from the repository root.

```sh
npm ci
cp .env.example .env
npm run dev
```

The example selects `STORE_DRIVER=fs`, `DATA_DIR=.data`, localhost and disabled checkout. No hosted credentials are needed. An absent `SESSION_SECRET` generates an ephemeral development value and a warning. Set a persistent random value of at least 32 bytes locally if signed upload tickets must survive restarts.

`npm run dev` serves public pages and APIs at `http://localhost:3000`, and the hot-reloading admin at `http://localhost:5173/admin/`. The first startup seeds an empty store. Existing initialized content is preserved. A built local run uses the same filesystem driver by default.

```sh
npm run build
npm run start
```

Open `http://localhost:3000/admin` for the built admin. **`npm run build` is the single application build path**, producing the SPA and checking both TypeScript projects. Public HTML is rendered from the store on request.

### Create local accounts

For a fresh scratch store, the development fallback is `Phil` / `Phil` when no hashed configuration is supplied. Use your own accounts for ongoing work. Generate each password hash interactively with the existing `scripts/hash-password.ts` command.

```sh
npm run hash-password
```

It reads hidden stdin and prints a scrypt hash. Put the hashes into the ignored `.env` file, using the following shape and replacing both placeholders with complete generated hashes.

```dotenv
ADMIN_BOOTSTRAP_USERS='[{"username":"Phil","displayName":"Phil","role":"Owner","passwordHash":"<generated hash>"},{"username":"Chris","displayName":"Chris","role":"Owner","passwordHash":"<generated hash>"}]'
ADMIN_FORCE_PASSWORD_CHANGE=false
```

Then run `npm run bootstrap` against the same `DATA_DIR` and restart the server to load changed environment values. Bootstrap also runs lazily on admin access. It seeds accounts only when the user table is empty and audits each creation. Later environment changes are inert, including after username changes. Add subsequent accounts through Users. To reset an existing account, use Users while signed in as an authorized administrator. Bootstrap account password changes stay optional with `ADMIN_FORCE_PASSWORD_CHANGE=false`. Accounts created or reset through Users receive a generated one-time temporary password and must choose a different password in Profile before opening content, previews or the workspace. New passwords must differ from the current password and meet the server's length, username and common-password rules. Generated create/reset passwords appear once in the admin acknowledgement dialog.

### Choose the right seed command

| Command | Use |
| --- | --- |
| `npm run seed` | Initialize a new empty store with all repository content and an initial publication |
| `npm run seed:store` | Add missing merchandise showcase records to an initialized store |
| `npm run seed:media` | Register missing shipped static images in an initialized store's media library |
| `npm run bootstrap` | Seed configured users only into an empty user table |

The general seed can reset repository-owned content. Its edited-version guard is helpful but does not make it an upgrade command. **Do not run general `seed` or `seed -- --force` as a deployment step against an edited/live store.** The additive commands preserve existing content, drafts, trash, users, sessions and history, publish only their own new records, accept no force option, and can be rerun after interruption. Static media registration does not upload files. Details and expected counts are in the deployment runbook.

## Testing

```sh
npm run build
npm test
npm run check-facts
npm run test:e2e -- --list
```

`npm test` runs the plain-Node function packaging smoke, then Vitest unit, HTTP, Store contract, golden, shop and performance tests. Filesystem tests always run. Postgres and private Blob checks print **not run (no env)** when their environment variables are absent. Unit tests use isolated temporary stores.

Goldens live only in `tests/golden/`. The tests compare all eight club pages after URL/entity/whitespace normalization, the authorized Admin link exclusion and the merchandise navigation addition. Keep these fixtures as reviewed references. Any intentional fixture edit must be reviewed independently of the renderer change. The facts check verifies 122 inventory facts. No legacy build or golden-export step is required.

### Local PostgreSQL through Docker

For adapter and SQL performance verification, use a disposable PostgreSQL 17 database and the Neon driver's local WebSocket proxy. Docker must be running. This adds no application dependency. Set `WS_PORT` to the port printed by `docker port`.

```sh
docker run --name psc-pg --rm -e POSTGRES_PASSWORD=local-test-only -p 127.0.0.1::5432 -d postgres:17
docker run --name psc-ws --rm --link psc-pg:postgres -e APPEND_PORT=5432 -e ALLOW_ADDR_REGEX='.*' -p 127.0.0.1::80 -d ghcr.io/neondatabase/wsproxy:latest
docker port psc-ws 80
WS_PORT=<printed-port>
DATABASE_URL='postgresql://postgres:local-test-only@postgres:5432/postgres?sslmode=disable' POSTGRES_TEST_WS_PROXY="127.0.0.1:${WS_PORT}/v1" npm test -- --maxWorkers=1
docker stop psc-ws psc-pg
```

Tests create and remove isolated schemas. The database user needs schema-creation privileges. `POSTGRES_TEST_WS_PROXY` is strictly for disposable local tests. Real Neon uses its secure default transport. Local PostgreSQL coverage does not verify the hosted Neon or Blob services.

### Playwright with installed Chrome

```sh
npm run build
npm run test:e2e
```

Playwright defaults to installed Google Chrome (`PW_CHANNEL=chrome`), starts the built app with generated credentials in a fresh `.cache/e2e-*` filesystem store, and runs serially because specs share that server. Stop any existing server on port 3000 first. Keep `workers: 1`. Browser execution in the Codex sandbox is **not run (sandbox)**. Run it from an unrestricted terminal for the 390px/1280px, keyboard, media, publishing and permissions flows. Lighthouse/manual accessibility checks also require a real browser.

For required form fields, use exact role/name locators such as `page.getByRole('textbox', { name: 'Title', exact: true })`. The visible required-field asterisk is hidden from the simple field's accessible name. Use `getByRole('combobox', { name: 'Category', exact: true })` for a labelled select and the exact `Create <thing>` button name. Avoid broad label/text matches that can include fieldsets, helper text or option lists.

## Roles and permissions

The server enforces the shared permission matrix. Hiding a control in the SPA is an additional UI behavior.

| Capability | Viewer | Contributor | Editor | Admin | Owner |
| --- | --- | --- | --- | --- | --- |
| Read content/history and preview drafts | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit content and catalog drafts, request review | — | ✓ | ✓ | ✓ | ✓ |
| Upload media, edit own uploads | — | ✓ | ✓ | ✓ | ✓ |
| Edit others' media, delete unused media | — | — | ✓ | ✓ | ✓ |
| Publish, unpublish, schedule, approve/return review | — | — | ✓ | ✓ | ✓ |
| Trash, restore trash, reorder, run link checks | — | — | ✓ | ✓ | ✓ |
| Edit site/store settings | — | — | ✓ | ✓ | ✓ |
| Read/export audit and export content | — | — | — | ✓ | ✓ |
| Manage Viewer–Editor accounts | — | — | — | ✓ | ✓ |
| Manage Admin/Owner accounts | — | — | — | — | ✓ |
| Rebuild published snapshot | — | — | — | ✓ | ✓ |
| Restore a whole site version | — | — | — | — | ✓ |

Contributors request review of ordinary content through the editor/tray, and publishers approve or return it with a note. Pending media is published by a publisher. Accounts cannot change their own role, and the last active Owner is protected. Every user can manage their own profile/password/sessions.

## Merchandise proof of concept

The seeded showcase has ten products, three bundles and five categories, with product/category/bundle pages, a cart and admin catalog tools. Prices are illustrative and no orders are accepted. `storeSettings.enabled` controls showcase visibility.

Keep **`SHOP_CHECKOUT=disabled`** in every deployed environment. It is also the default when unset. Checkout/order/payment/webhook requests return HTTP 403 with `checkout_disabled` before processing, and the checkout page has no form. Content settings cannot override this boundary. `enabled` is accepted only with `NODE_ENV=development` or `test`, and production configuration rejects it. Payment integration and operational order processing remain future work.

## Operations

### Deploy and migrate

Follow [README-deploy.md](README-deploy.md) for the account-neutral Vercel checklist, complete environment table, private Blob setup, migrations, additive seeds and validation steps. Set production secrets and `ADMIN_BOOTSTRAP_USERS` before the first admin request. Run `npm run db:migrate` with the target `DATABASE_URL` before initial seeding/startup and whenever a release introduces SQL changes. It is transactional and idempotent. HTTP requests do not run migrations. Normal code releases need no general reseed.

### Back up and restore the database

Before a schema change, record the source revision/schema version and take a full database backup using a trusted operator environment. Verify the target database before running these commands. Use a PostgreSQL client compatible with the server version and supply `DATABASE_URL` securely.

```sh
pg_dump --format=custom --no-owner --no-acl --file=prospector-backup.dump "$DATABASE_URL"
# Point RESTORE_DATABASE_URL at a NEW empty recovery database.
pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" prospector-backup.dump
```

Protect backups as secrets because they contain password hashes, sessions and audit data. Keep retention and test restores. Preserve the private Blob store/binaries separately, including historic versions. Admin content JSON exports are useful for inspection but omit account/session/history data required for complete recovery.

For an incident, stop editor writes, preserve the affected database, restore into a new database/Neon branch, and validate a compatible app against it. Check sign-in, snapshots, history and retained media. Point the deployment at the recovery database and redeploy only after review. For a code regression, a compatible prior deployment can be selected in Vercel, with database compatibility checked separately. See the deployment runbook for these distinct recovery paths.

### Restore a site version in the admin

Sign in as Owner. Open **History → Site versions**, find the desired version, and choose **Compare with current**. Review draft/live changes, order, later documents and schedule effects. Choose **Restore site to this version**, add a note and confirm. A concurrent change requires a fresh comparison.

Restoration creates a new published version and new revisions, preserves prior history, unpublishes later-created documents while retaining their drafts, and cancels schedules. Use View live to verify the result. For a single document, open its History, restore the desired revision to a draft, then publish it. A failed publication after a draft restore is reported separately so the saved draft can be reviewed again.

### Unlock an account

Load the intended store environment and run `npm run unlock -- <username>`. It clears the user's pair locks and username throttle through an audited lock-generation change. The shared IP login limit remains in force. Use Users to reset a forgotten password or reactivate an account as appropriate. Bootstrap does not replace existing credentials.

### Rotate secrets

- Change passwords through Profile or an authorized Users reset. Profile rejects a new password equal to the current one, including temporary passwords. Credential changes revoke older sessions. Use Sign out everywhere for an immediate account session revocation. Update any retained bootstrap hash to match your intended future bootstrap configuration.
- Generate a new random `SESSION_SECRET` of at least 32 bytes, update the environment and restart/redeploy. Existing signed upload tickets must be retried. Session authentication uses stored opaque tokens, so use the account session-revocation controls when session invalidation is required.
- Replace `CRON_SECRET` in the deployment environment and in any external scheduler using it, then verify authorized settlement.
- Rotate Neon credentials and the private Blob token with their provider. Install the replacement environment values, restart/redeploy, verify DB reads/writes and media upload/delivery, then revoke superseded credentials. Preserve access to existing media and backups throughout the change.

### Go live

Indexing is fail-closed. `seo.indexable` defaults to `false` in the schema and seed, and missing values also render `noindex`. Before adoption, keep that value. At approved go-live, open **Site settings → Search engines**, enable **Indexable**, then review and publish the site settings. Verify the public HTML's robots meta, `/robots.txt` and `/sitemap.xml` on the configured `PUBLIC_BASE_URL`.

In **Site settings → Utility bar**, replace the **Pill text** containing `Redesign concept` and edit **Message** / **Message long** as needed, then publish. Keeping the utility bar enabled retains its Admin entry link. This changes content through the CMS. The checkout boundary is a separate environment control.

## Known issues and limitations

- Full bounded server-side image decoding is deferred (A3). The server verifies headers, dimensions, MIME and size, and requires a client-produced WebP variant of at most 2000px. It does not decode complete pixel payloads or bound animation frame counts and aggregate decoded memory.
- Strict zero-write cold or aged reads are deferred (A2). Warm GET/HEAD performance budgets remain enforced. Sliding sessions can refresh once per 15 minutes, revision maintenance can claim work once per 10 minutes, and due schedules or expired health caches can write.
- Draft-media lookup can scan media records (F11). This is a performance limitation.
- Published media sends `public, max-age=0, s-maxage=300, stale-while-revalidate=60` and carries the content cache tag. Publication purges tagged pages and media together. If purging fails, shared caches can serve an old response for up to six minutes. Responses already cached under earlier policies retain those lifetimes. Downloaded files and historical binaries remain retained.
- Each user has a configurable `MAX_UPLOAD_BYTES_PER_DAY` quota, default 256 MiB per rolling 24-hour window. Issuing each original or web-variant ticket reserves its declared bytes, including abandoned, rejected or failed uploads. The quota persists across app instances. Each original and web grant is consumed atomically with its successful finalization. An identical finalize retry returns the saved result without another copy. Reusing a consumed grant for another create or replace request is rejected. Failed attempts before the metadata commit remain retryable until the grant expires. Tickets issued before the single-use protocol upgrade must be requested again. Existing media records remain readable. Uploads also retain their existing hourly ticket and per-file limits.
- The command palette defaults to Dashboard navigation. **Publish all** opens the populated **Review & publish** tray and requires confirmation there.

- Very fast repeated `[` / `]` presses before the next editor renders can be ignored. The shortcuts save before changing documents and leave text input alone.
- Editing presence is per warm server instance. Visible editors send a heartbeat at most every 30 seconds, and entries expire after 75 seconds. Other instances have separate presence maps, restarts clear them, and closed editors can linger until expiry. Version checks enforce write concurrency.
- Constrained Markdown, explicit reload-and-compare conflicts and administrator-performed password resets are the current supported workflows. Email resets, full FS-history import, verified-binary garbage collection and automatic backup scheduling need separate implementation. Media validation checks signatures/dimensions, with retained originals and still-image WebP previews for animated inputs.

The implementation plan, decisions and phase verification history live in [plans/admin-plan.md](plans/admin-plan.md) and [plans/admin-progress.md](plans/admin-progress.md).

Finalization records a cleanup intent before copying. Failed deletions and process interruptions retain that intent. Cron retries at most 100 intents older than 24 hours per run, recovers pending metadata first, and preserves draft, scheduled and published-history references. This cleanup is limited to finalization attempts.
