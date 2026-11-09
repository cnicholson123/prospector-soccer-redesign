# Deploying Prospector Soccer Club

The public site renders from the content store. Admin Phases 7–10 include the content editors, preview/publish/scheduling, history/audit, and the media library with image/PDF uploads. User management and the remaining Phase 11 work are tracked separately. See [the plan](plans/admin-plan.md) (§17–§19 override earlier sections) and [the progress log](plans/admin-progress.md).

## Project and storage setup

Use Vercel team **chrisbot2026s-projects**, project **prospector-soccer-redesign**. No account credentials or project link were created by this implementation.

1. In that team's dashboard, create/select the project and import this repository when authorized. Use the repository root, framework **Other**, Node **22.x or later**, build command `npm run build`, install command `npm ci`, and output directory `public`. Keep the two functions and routing in `vercel.json`. The functions export Web-standard `{ fetch }` handlers; do not replace these with bare default functions.
2. Connect **Neon Postgres** from the Marketplace. Use a dedicated database/schema for this application and the pooled TLS connection string for `DATABASE_URL`. Use separate Neon branches/databases for Preview and Production; previews must not mutate production data.
3. Create a **private** Vercel Blob store, connect it to the project, and install its `BLOB_READ_WRITE_TOKEN`. Separate Preview and Production stores are recommended. A public Blob store is not supported. Blob contains binaries only; there is no Blob-KV metadata driver.
4. Set the environment below separately for Preview and Production before the first application request. Configure `PUBLIC_BASE_URL` to the precise HTTPS origin used for each environment. Preview authentication/Origin checks require a stable preview alias or an environment value for that deployment's URL.
5. Once credentials and a deployment are authorized, the CLI equivalent of selecting the project is:

   ```sh
   vercel link --scope chrisbot2026s-projects --project prospector-soccer-redesign
   ```

   Review `.vercel/project.json` locally after linking. It is ignored. Do not commit tokens, connection strings, downloaded env files, or populated `.env` files.

Official references: [Vercel link](https://vercel.com/docs/cli/link), [CLI scope](https://vercel.com/docs/cli/global-options), [Neon driver](https://neon.com/docs/serverless/serverless-driver), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [client uploads](https://vercel.com/docs/vercel-blob/client-upload).

## Environment variables

| Name | Local value/default | Production |
| --- | --- | --- |
| `NODE_ENV` | development | `production` |
| `STORE_DRIVER` | `fs` | `postgres`; only these two values are accepted |
| `DATA_DIR` | `.data` | Not used by the production store |
| `DATABASE_URL` | Optional; tests skip without it | Neon pooled TLS URL; server only |
| `BLOB_READ_WRITE_TOKEN` | Optional; real-service test skips without it | Token for a private Blob store; server only |
| `SESSION_SECRET` | Ephemeral if absent | Persistent random secret, at least 32 bytes; signs upload tickets |
| `ADMIN_BOOTSTRAP_USERS` | Optional secret JSON array | Required array of `{username, displayName, role, passwordHash}` for Phil and Chris, both Owner |
| `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` | Local single-user fallback; legacy `ADMIN_BOOTSTRAP_USER` alias supported | Development only |
| `ADMIN_FORCE_PASSWORD_CHANGE` | `false` | **`false`**; password changes are optional |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Exact HTTPS origin, initially `https://prospector-soccer-redesign.vercel.app` if assigned |
| `COOKIE_SECURE` | `false` | `true` |
| `CACHE_SMAXAGE` | `0` | `15` |
| `CACHE_SWR` | `0` | `300` |
| `CDN_PURGE` | `off` | `tag`, or `off` for troubleshooting |
| `CRON_SECRET` | Optional | Independent random bearer secret for GET/POST `/api/admin/cron/settle` |
| `TZ_NAME` | `America/Los_Angeles` | Same |
| `MAX_IMAGE_BYTES` | `8388608` | Same (8 MiB) |
| `MAX_FILE_BYTES` | `15728640` | Same (15 MiB, PDFs) |

Production configuration rejects missing bootstrap credentials, short/missing session secrets, insecure cookies, and non-HTTPS public origins. `DATABASE_URL` is required with `STORE_DRIVER=postgres`; the Blob token is required when hosted media is used. Nothing is injected into the browser as a `VITE_*` secret.

## Migration, initial content and bootstrap

On an authorized workstation with the intended environment loaded securely:

```sh
npm ci
npm run db:migrate
npm run db:migrate  # safe repeat; also tested
npm run seed
npm run bootstrap
npm run build
npm test
```

`db:migrate` runs the SQL in one transaction, under the same advisory writer lock as the store, and records schema version 1. It creates separate docs, revisions, publishes, snapshots, audit, users, sessions, rate_limits and meta tables. Each stores its complete JSONB envelope with indexed generated columns; optional fields, exact timestamp strings, and later-phase additions round-trip without serialization loss. Username keys are supplied by JavaScript `toLowerCase()` and uniquely indexed. This is a deliberate extension of the plan's illustrative flattened SQL layout. Database triggers protect sealed revisions and immutable audit/publish history.

Run migrations explicitly before seeding or starting the application; HTTP handlers do not perform DDL. Keep schema changes additive for rollback compatibility. `seed` is idempotent and refuses to overwrite edited content unless explicitly forced. Do not use `--force` on a live database as a deployment step. This release seeds a new production database; it does **not** provide a full FS-to-Postgres import of existing edit history/users/sessions. Export and plan that separately if local edited data must be preserved.

`npm run hash-password` prompts for a password with terminal echo disabled and prints only its scrypt hash to stdout. It also accepts one password through stdin for secret-manager pipelines. Never pass a password as an argument, paste it into a shell command, commit it, or include it in logs. Run the command separately for Phil and Chris, then use the hashes in the secret `ADMIN_BOOTSTRAP_USERS` JSON array. Each entry has `username`, `displayName`, `role` (`Owner` for both initial accounts), and `passwordHash`. The hash must match the canonical scrypt format from `server/auth/password.ts`. The configuration validates the complete array before any creation and rejects duplicate case-insensitive names, invalid roles/hashes and arrays without an Owner. Configure strong passwords. Strength is re-evaluated at login because it cannot be inferred from a hash.

Bootstrap creates missing users only, under the store's writer lock/transaction, and records `system.bootstrap` per creation. Existing users retain their password, role, name and status. Restart or run `npm run bootstrap` to add a later configured account. Removing an entry never deletes an account. The application also bootstraps lazily on its first non-health admin request. Concurrent runs and interrupted FS writes are safe to retry.

Set `ADMIN_FORCE_PASSWORD_CHANGE=false` in production. It also defaults to false. Password changes are always available through Profile. Weak credentials show an optional reminder, dismissible for the browser session, and a restricted dashboard health item. Existing `mustChangePassword` flags are retained for compatibility; changing bootstrap configuration does not rewrite existing users. There is no email reset provider; another authorized administrator resets credentials.

Only after the above checks and separate authorization:

```sh
vercel --scope chrisbot2026s-projects          # Preview
vercel --prod --scope chrisbot2026s-projects   # Production
```

These commands were **not run** during Phase 6. Verify the health endpoint, public pages, login, private draft preview, publication, version restore, and media upload before giving editors access. Confirm the live Blob store is private and unauthenticated direct storage URLs are denied. Keep `seo.indexable=false` until adoption is approved.

## Storage and upload protocol

All Postgres mutations use real SQL transactions, compare document versions, and take a transaction-scoped advisory lock across application instances. Document/revision/audit changes and reorders commit together; publish's documents, sealed history, audit, kind-tagged record and snapshot commit together. Interrupted SQL transactions roll back, so `recoverPublish()` reports the last committed snapshot with `repaired:false`; retrying a committed transaction accepts only identical contents. FS continues to use its existing lock and replay journals.

1. Authenticated clients request `POST /api/admin/media/upload-url` with `{filename,mime,size}` and cookie/CSRF/Origin headers. Grants are limited to 60 per hour per user, bind the owner and exact incoming path, and expire in 15 minutes.
2. For Blob, call `upload()` from `@vercel/blob/client` with the returned `pathname`, `access:'private'`, `handleUploadUrl`, and the same CSRF/Origin headers via its `headers` option. The token endpoint only grants that exact `media/incoming/<id>/original.<ext>` path, MIME, size ceiling and expiry, without overwrite or random suffix. SDK completion callbacks use `/api/admin/cron/blob-upload`, are signature-checked by the SDK, and never create media records. Every ordinary admin route requires a session; only login, healthz and the cron namespace are exempt, with each cron handler enforcing its own bearer or signature credential.
3. For FS, PUT the raw bytes to the returned `uploadUrl` with those headers and exact Content-Type. The local binary endpoint enforces actual body bytes separately from the 1 MiB JSON cap. Quarantine objects cannot be overwritten or served publicly.
4. The browser retains the original (up to 8 MiB for images), creates a WebP with its longest edge at most 2000 pixels, and uploads both using separate owner-bound grants. `POST /api/admin/media` with `{ticket,webTicket?,alt?,caption?}` finalizes the upload. PDFs use only `ticket`; the original-only Phase 6 API remains compatible. Client URLs and dimensions are ignored. The server downloads from its own storage path, bounds actual size, checks declared MIME against magic bytes, and parses intrinsic JPEG/PNG/WebP/GIF dimensions. SVG and other formats are rejected; PDFs use a PDF signature check. Excessive dimensions/pixel counts are rejected. Both originals and WebP variants are verified independently; WebP variants over 2000 pixels in either dimension are refused. Verified bytes are copied to immutable `media/<yyyy>/<mediaId>/original.<ext>` and (when supplied) `web.webp` paths, then metadata/history/audit are created and the incoming copy is deleted. Partial finalization can safely retry; no unverified metadata is created.
5. `POST /api/admin/media/:id/replace` uses the same verified tickets plus `baseVersion`, preserves the media ID, and saves a new draft with fresh immutable URLs. It checks ownership, media kind and document version, and appends revision/audit records. Old published files remain retained; publish the media change to switch the live URL. Metadata PATCH supports only alt, caption and focal point; DELETE soft-trashes only media with no draft, published or scheduled usage.
6. `/media/media/...` proxies private Blob bytes through the existing render function. Local FS uses `/blobs/media/...` with the same policy. Only verified files referenced by current published metadata/snapshots are public; other verified drafts need a content-reading session. Responses enforce `nosniff`, fixed allowlisted MIME, and sandbox CSP. Metadata holds these application URLs, never secret-bearing or raw private Blob URLs.

The daily authenticated cron settles schedules, removes expired sessions, and removes unfinalized incoming files older than 24 hours. It never garbage-collects verified media. Historical binaries remain retained; FS also rejects deletion/overwrite when referenced by a publication. Metadata deletion is soft and reference-checked. If finalization cannot record metadata after copying, the verified orphan is retained for a retry; orphaned final binary GC is out of scope.

## Verification without hosting credentials

```sh
npm run build
npm test
npm run check-facts
npm run test:e2e -- --list
```

FS always runs. With `DATABASE_URL`, the **same shared Store contract** and additional SQL rollback/migration tests run in random isolated schemas and drop only those test schemas. The database user needs schema-creation privileges for tests. Without env, Postgres/Blob tests explicitly report **not run (no env)**. `BLOB_READ_WRITE_TOKEN` enables a real private Blob binary round trip under `media/incoming/contract_…`, followed by deletion. It does not test a fictitious Blob metadata adapter.

A real PostgreSQL 17 run was performed locally through the Neon driver's WebSocket transport. Reproduce with disposable Docker containers (free host ports), no new npm dependency:

```sh
docker run --name psc-pg --rm -e POSTGRES_PASSWORD=local-test-only -p 127.0.0.1::5432 -d postgres:17
docker run --name psc-ws --rm --link psc-pg:postgres -e APPEND_PORT=5432 -e ALLOW_ADDR_REGEX='.*' -p 127.0.0.1::80 -d ghcr.io/neondatabase/wsproxy:latest
docker port psc-ws 80
# Set WS_PORT below to that assigned host port.
DATABASE_URL='postgresql://postgres:local-test-only@postgres:5432/postgres?sslmode=disable' POSTGRES_TEST_WS_PROXY="127.0.0.1:${WS_PORT}/v1" npm test
# Optional full prior-phase HTTP suites, on this disposable database:
DATABASE_URL='postgresql://postgres:local-test-only@postgres:5432/postgres?sslmode=disable' POSTGRES_TEST_WS_PROXY="127.0.0.1:${WS_PORT}/v1" POSTGRES_HTTP_TESTS=1 npx vitest run tests/unit/auth.test.ts tests/unit/content-engine.test.ts --testTimeout=60000 --hookTimeout=60000
docker stop psc-ws psc-pg
```

The test helper applies the local proxy settings only when `POSTGRES_TEST_WS_PROXY` is set, including disabling TLS and Neon-specific password pipelining. Never use that variable outside isolated local tests. Real Neon keeps the driver's default secure WebSocket endpoint.

Browser Playwright execution is **not run (sandbox)** here. The Phase 6 spec adds real HTTP upload/quarantine/finalization/publication assertions; Claude runs the specs afterwards with installed Chrome. No visual, browser or Lighthouse pass is claimed.

## Rollback and recovery

Before migrations, take a **full Postgres backup** (all tables, not just content JSON), record the deployed source revision and schema version, and confirm Neon restore/branch retention for the chosen plan. Keep Blob binaries and their storage connection separately: restoring Postgres does not restore missing binaries. The admin content export omits users, sessions and complete history and is not a database backup.

For an application regression, restore the prior known-compatible Vercel deployment using the dashboard's Instant Rollback. It changes application traffic, **not** database or Blob state. Rollback reuses the prior build/environment; changed environment values require a new deployment. Do not roll back to the pre-Phase-6 FS-only code while pointing it at Postgres. See [Vercel rollback semantics](https://vercel.com/docs/instant-rollback).

For an unwanted content publication, use the Owner-only `POST /api/admin/publishes/<siteVersion>/restore` endpoint with a summary, session and CSRF/Origin headers. It creates a new publication, restoring data and order while retaining history. It is not a schema rollback. Cache purge failures remain visible; correctness falls back to the configured cache window.

For a schema/data incident, stop writes, preserve the failing database, restore its backup into a **new** Neon branch/database, verify the compatible application against it, update `DATABASE_URL`, and redeploy after authorization. Do not drop tables or reverse migration 1 on the only production copy. No destructive down migration is provided. If a connection dies mid-transaction, Postgres discards the transaction; retry only the same request payload or re-read versions. FS journal recovery continues automatically on the FS driver.

## Security summary and remaining plan gaps

- Passwords use the specified scrypt parameters; unknown-user checks still hash. Sessions use random 32-byte IDs stored as hashes, HttpOnly/SameSite cookies and Secure in production, idle/absolute expiry, hourly refresh, credential generations and revocation. Successful logins, the first failure per IP per 15-minute window, and pair lock transitions are audited with IP/UA. Repeat failures are counted in persistent rate-limit records without appending repeated audit entries.
- Server-enforced roles, last-Owner checks, CSRF/Origin protection, persistent rate limits, optimistic versions, required content audit and atomic storage operations are shared across both drivers. Rich text/template escaping and SSRF-resistant link checking remain unchanged.
- Upload verification is format/signature and dimension validation, **not antivirus scanning or full image/PDF decoding**. The Phase 10 browser creates WebP variants through canvas and the server verifies their MIME, size and dimensions. Older original-only media remains usable without automatic rewriting. Animated image originals are retained; the canvas web preview is a still image.
- Phase 11 user/review/palette work and Phase 12 cleanup remain tracked in the progress log. Browser, visual and accessibility acceptance for Phase 10 remains unverified until Chrome runs the new specs.
- Real Neon, real private Blob, Vercel preview/production deployment, hosted cache purge, cron delivery and preview-domain configuration remain unverified without credentials. Daily cron/Hobby remains an assumption from §17, not an account-plan verification.
- A single advisory writer lock trades throughput for clear cross-document/account correctness at this small site's scale. No automatic full-backup scheduler, FS-history import, binary GC, per-field merge, antivirus service, email password reset, or database RLS is added. Database access is server-only; do not distribute its credentials.

## Phase 6b security operations

Login locks are scoped to `(username, IP)` (five failures, 15-minute initial lock, doubling up to 24 hours). A separate username-wide limit slows distributed failures after 100 per 15 minutes; it does not reject a correct password from a non-offending IP. The existing 10-per-15-minute IP limit also applies. To clear pair locks and the username-wide throttle locally, run `npm run unlock -- <username>` against the intended store. This writes an `auth.unlock` audit entry and advances the account's lock generation; it does not change the password or clear the IP-wide limit shared by all accounts.

The API trusts the first `X-Forwarded-For` value **only behind Vercel's trusted ingress**, which must overwrite untrusted client forwarding headers. Do not expose the Hono app directly behind a proxy that simply passes client XFF through. The local Node adapter overwrites XFF with the socket peer. Production uses `__Host-psc_session` with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain; development retains `psc_session`.

Every changed document envelope now advances its version, including publish/unpublish/schedule/cancel/settlement. Clients must reload document versions after those operations. A trash operation preserves existing live membership until that document is selected for removal; rebuilding or publishing unrelated content does not release the deletion. Frozen scheduled references participate in atomic trash checks. A failed lazy settlement appears as `schedule_failed` in dashboard health without blocking authentication, logout or repair requests.

Restore with `publish:true` returns the committed `doc`. On success it also returns `published:true` and publication details; if publication fails it returns HTTP 200 with `published:false` and `publishError:{code,message,details?}`. Clients must show the saved draft and the separate publication failure, and must not display a success toast for that publication. This explicit partial-success contract avoids implying that a failed publish rolled back the restored draft. Generic revision restore of media is denied; approved metadata fields use the media editing endpoint.


## Store showcase deployment

The seed publishes ten concept products, three bundles and five categories, with `storeSettings.enabled=true`. The navigation reads **Merch (concept)**. Store pages label prices as illustrative and state that no orders are accepted.

`SHOP_CHECKOUT=disabled` is the default in **every** environment, including when unset. Keep it disabled for deployment. Checkout, order, payment and webhook routes return HTTP 403 `{ "error": "checkout_disabled" }` before request processing; the checkout page has no form. Store settings cannot override this deployment control. No payment credentials are required or used by this phase.

`SHOP_CHECKOUT=enabled` is accepted only with `NODE_ENV=development` or `test`; configuration loading refuses it in production or any other environment. It exposes the existing development form for future work; order/payment implementation remains deferred.

### Existing production database (including the original 111 documents)

**No database migration is required.** This showcase uses the existing `docs`, `revisions`, `publishes`, `snapshots` and `audit` tables. Content schema version 2 is snapshot metadata, not SQL migration 2. No order, payment or inventory tables are added. Do not run the general `npm run seed` against this live store: it refuses edited documents, and `--force` can replace live edits with repository content.

From this checkout, with the intended production environment already loaded securely (`DATABASE_URL`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_USERS`, `PUBLIC_BASE_URL`, `COOKIE_SECURE` and other configured values), run:

```sh
npm ci
npm run build
NODE_ENV=production STORE_DRIVER=postgres SHOP_CHECKOUT=disabled npm run seed:store
NODE_ENV=production STORE_DRIVER=postgres SHOP_CHECKOUT=disabled npm run seed:store
```

The first run against the original 111-document database reports `34 created, 34 published, 0 preserved` and advances the existing site version by one. It adds 10 products, 3 bundles, 5 categories, `shopPage`, `storeSettings` with `enabled=true`, 4 shop FAQs and 10 static store media records (20 existing WebP assets). The second run reports `0 created, 0 published, 34 preserved` at the same site version. It writes no new documents, revisions, audit or publication records. No bootstrap, restore, full seed, `--force`, SQL migration or Blob upload is part of this sequence. `seed:store` takes no arguments. It requires an initialized store with publication history and does not invoke bootstrap or modify users, sessions or operational data.

Only missing store seed IDs are created. Existing documents—including store records, edited version-1 records, pending drafts, trash and disabled settings—keep their data, versions and history. New documents receive sealed `created` and `published` revisions and `content.create` / `content.publish` audit entries under actor `seed` (name `Store showcase seed`, source `seed:store`). Publication uses the normal locked/journaled Store transaction, appends a complete manifest reusing all existing revision references, preserves schedules and existing published content, and purges the content cache best-effort. A failure during creation can leave audited private drafts; rerunning resumes only this command's untouched drafts. A failed/interrupted publication is recovered by the existing FS journal or rolled back by Postgres. A concurrent edit/publication is preserved and may require rerunning the command after the other writer finishes.

If store IDs already exist, the counts differ. The command deliberately does **not** enable an existing disabled `storeSettings`, publish an existing editor draft, restore trash, or repair an incompatible existing dependency. Incompatible dependencies fail validation instead of being overwritten. Review and publish those specific store changes through the admin UI if intended; do not use the general seed or a site restore to force the showcase. When all store IDs are new, the sequence above publishes the full showcase without touching the original 111 documents.

After the application release is deployed, verify `/` has **Merch (concept)**; `/shop`, `/shop/p/crest-hoodie`, `/shop/b/coach-kit` and `/shop/c/apparel` render with the concept banner; cart quantities work; and `/shop/checkout` has no form. A POST to `/api/shop/checkout` must return HTTP 403 `{"error":"checkout_disabled"}`. Keep `SHOP_CHECKOUT=disabled` in the deployment environment. If cache invalidation is unavailable from the workstation, use a fresh `?v=<reported-site-version>` URL for verification and allow existing CDN entries to expire. The seed command does not deploy application code.

### Local review and verification

For a **new, isolated** filesystem store, run:

```sh
STORE_DRIVER=fs DATA_DIR=.cache/store-showcase-local npm run seed
STORE_DRIVER=fs DATA_DIR=.cache/store-showcase-local SHOP_CHECKOUT=disabled npm run start
```

For an existing local filesystem store, use `STORE_DRIVER=fs DATA_DIR=<existing-directory> npm run seed:store` twice instead. The same preservation and audit rules apply on FS and Postgres. The store-seed contract suite starts from the original 111 records, includes live/pending edits, trash, schedules, users and session data, checks existing document and history values exactly, and exercises repeated runs and interrupted creation/publication. Run it with `npx vitest run tests/shop/seed-store.test.ts`; to test Postgres, use the disposable Docker PostgreSQL 17 + WebSocket proxy sequence in “Verification without hosting credentials” above with that test command. Real Neon/Blob checks remain **not run (no env)**; browser execution remains **not run (sandbox)** until run outside the sandbox.


## Phase 10: register existing static media safely

Production already has content, accounts, history and ten store media records. **Do not run the general `seed` or `seed --force` against that database. No SQL migration is needed for Phase 10.** After the application update, use this additive command from an authorized workstation with the intended environment loaded securely:

```sh
NODE_ENV=production STORE_DRIVER=postgres SHOP_CHECKOUT=disabled npm run seed:media
NODE_ENV=production STORE_DRIVER=postgres SHOP_CHECKOUT=disabled npm run seed:media
```

`seed:media` reads the 26 static media definitions already in `content/seed/media.json`: 16 site images and 10 store images (each store record includes its small variant). When only the ten store records exist, the first run reports `16 created, 16 published, 10 preserved`; the second reports `0 created, 0 published, 26 preserved` at the same site version. Counts vary when more records already exist. It neither uploads binaries nor changes existing static URLs. The library reads actual stored metadata; GET requests never register images implicitly.

The command requires an initialized store and publication history. It creates only missing IDs, publishes only those newly created records, and leaves existing drafts, published content, media, users, sessions, trash, schedules and history untouched. New records receive sealed created/published revisions and audit entries with actor `seed`, name `Static media seed`, and source `seed:media`. It reuses the existing additive Store transaction and cache purge path from `seed:store`. A retry resumes only its own untouched version-1 drafts; concurrent edits are preserved, and stale publication is refused. A complete second run does no content, revision, audit or publication writes. No force option is accepted.

For local verification against an existing filesystem store:

```sh
STORE_DRIVER=fs DATA_DIR=.data npm run seed:media
npx vitest run tests/unit/seed-media.test.ts tests/unit/media-phase10.test.ts tests/unit/admin-media.test.ts
```

The static-media seed contract runs on FS and on Postgres when `DATABASE_URL` is supplied, with isolated test schemas. It covers preserved content/users/session/history, existing edited/trash records, repeat runs, interrupted creation and concurrent edits. Without service env, Postgres/private Blob checks report **not run (no env)**. The new `tests/e2e/admin-media.spec.ts` covers JPEG → ≤2000px WebP → default/per-use alt → sponsor publish → live image, in-use deletion refusal, missing-alt health clearing, and PDF upload → public resource link at 390px and 1280px. Browser execution remains **not run (sandbox)** here; Claude runs installed Chrome afterwards.
