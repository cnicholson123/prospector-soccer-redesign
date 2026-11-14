# Moving this project to Replit

Written for Phil on 2026-11-13. Read [HANDOFF.md](../HANDOFF.md) first; this guide only covers what is different on Replit.

**Short version.** The site was built for Vercel, and nobody has run it on Replit. The page rendering, admin and content model are ordinary Node code and will run there. Four things are tied to Vercel or Neon and need a decision or a small code change: the database driver, media storage, the web server entry point, and the daily cron job. The quickest working setup is Replit for the web server with the database kept on Neon. Running everything on Replit's own database and storage is possible, but it means writing two adapters.

Everything under "Replit facts" was read from Replit's documentation on 2026-11-13. Everything about this codebase was read from the code at commit `3256546`. None of it has been tried on a real Replit deployment, so treat the steps as a plan to verify, and check Replit's docs again if something has moved.

## What carries over and what does not

| Piece | On Vercel today | On Replit |
| --- | --- | --- |
| Public pages, admin UI, content schema, permissions, history | `server/`, `admin/`, `shared/` | Unchanged |
| Web server | Three serverless functions in `api/`, routed by `vercel.json` | Use the plain Node server, `npm run start` (`scripts/dev.ts --built`). Needs the changes in step 4 |
| Database | Neon Postgres through `@neondatabase/serverless` | Keep Neon (works as is), or write a standard-Postgres adapter for Replit's database |
| Uploaded media | Private Vercel Blob (`@vercel/blob`) | Keep Vercel Blob with your own token, or write an App Storage adapter |
| Images shipped with the site | `public/assets/` in Git | Unchanged; these need no storage service |
| Security headers, admin CSP, `.html` redirects | `vercel.json` | Not applied by the Node server. Must be ported (step 4) |
| Page caching and purge on publish | Vercel CDN, `@vercel/functions` | Not available. Turn caching off (step 3) |
| Daily cron | `crons` in `vercel.json` | A Replit Scheduled deployment that calls the cron URL (step 7) |
| Local filesystem storage (`STORE_DRIVER=fs`) | Development only | Do not use for a published app; see below |

## Replit facts this guide relies on

- **Published apps do not keep files.** Replit's docs say to "avoid saving and relying on data written to a published app's filesystem", and each publish starts from a fresh snapshot. So `STORE_DRIVER=fs` is fine for trying the site in the workspace and wrong for the published site: content, accounts and uploads would be lost.
- **Replit's built-in database is no longer Neon.** Since 4 December 2025 new databases run on Replit's own PostgreSQL 16 service, alongside the app and without TLS. This project's database code uses Neon's driver, which talks to Neon's own HTTPS and WebSocket endpoints. I expect it not to connect to Replit's database; this was not tested.
- **App Storage** (formerly Object Storage) is Replit's file store. Buckets are always private, and the Node package is `@replit/object-storage`.
- **Deployment types.** Autoscale ($2 a month base plus usage, sleeps after 15 idle minutes, so the first visit after a quiet spell is slow) or Reserved VM (always on, from $15 a month). Either can run this server. Both expose a single external port.
- **Ports.** Map the server's port to external port 80 in `.replit`. Replit also passes a `PORT` variable and recommends binding to it.
- **Secrets** are set under Tools → Secrets and sync to the published app when you publish or republish.
- **Scheduled deployments** run a command on a cron schedule.
- **Custom domains** are attached under Tools → Domains, with certificates issued automatically.
- **GitHub import** of a public repository: `https://replit.com/github.com/<owner>/<repo>`. It does not bring over environment variables or database data.
- **Not stated in Replit's docs**, so check them yourself: whether Node 22 is offered as a module (the docs show `nodejs-20`; this project requires 22.12 or later), whether `NODE_ENV` is set for you, whether devDependencies are installed for a published app, and which header carries the visitor's real IP address.

## Route A (recommended): Replit runs the server, Neon holds the data

This keeps the tested database code and needs the least new work.

### 1. Import and try it in the workspace

1. Fork or copy the repository to a GitHub account you control, then import it into Replit.
2. Make sure the workspace uses Node 22.12 or later (`node --version`).
3. In the Shell: `npm ci`, `cp .env.example .env`, `npm run build`, `npm run start`.

This runs on the filesystem driver with the development account **Phil / Phil**. It proves the code runs on Replit; it is not how the published site should run.

### 2. Create the outside services

- **Neon** (required): create your own Neon project and copy the **pooled** connection string. HANDOFF step 3 has the detail. The free tier is enough to start.
- **Vercel Blob** (only if editors will upload images or PDFs): create a **private** Blob store in a Vercel account and copy its read-write token. The store can exist without hosting the site on Vercel. I expect the token to work from Replit, but this was not tested.

If you skip Blob, the site and all shipped images still work. What fails without `BLOB_READ_WRITE_TOKEN` is everything under `/api/admin/media`, `/media/...`, and `/api/admin/cron/...`, including the daily cron in step 7, because that code path requires the token.

### 3. Secrets

Set these in Replit Secrets before publishing. HANDOFF steps 4 and 5 explain each one and how to generate the hashes and random values.

| Secret | Value on Replit |
| --- | --- |
| `NODE_ENV` | `production`. **Set this yourself and confirm it took effect.** Without it the app starts in development mode, with filesystem storage and the Phil / Phil account open to anyone |
| `STORE_DRIVER` | `postgres` |
| `DATABASE_URL` | Your Neon pooled connection string |
| `BLOB_READ_WRITE_TOKEN` | Your private Blob store token (if using media uploads) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | A second `openssl rand -hex 32` |
| `ADMIN_BOOTSTRAP_USERS` | JSON array from `npm run hash-password`, with at least one Owner |
| `PUBLIC_BASE_URL` | The exact HTTPS address of the published app, no trailing slash. Sign-in fails if it does not match the address in the browser |
| `COOKIE_SECURE` | `true` |
| `CDN_PURGE` | `off` (purging only works on Vercel) |
| `CACHE_SMAXAGE` | `0` |
| `CACHE_SWR` | `0` |
| `TZ_NAME` | `America/Los_Angeles` |
| `SHOP_CHECKOUT` | `disabled` (the server refuses anything else in production) |

With caching off, a publish is live immediately. The admin's publish message will still say "Live within about 5 minutes", because that wording is tied to the Vercel purge.

### 4. Code changes the Node server needs

`scripts/dev.ts` was written as a local development server. Four things must change before it faces the public. I suggest copying it to a new `scripts/serve.ts` for production rather than editing the development server, and pointing `npm run start` at the copy.

1. **Visitor IP address.** Line 31 replaces `x-forwarded-for` with the socket's address. Behind Replit's proxy that is the proxy, so every visitor looks like one address. Sign-in is limited to 10 attempts per address per 15 minutes (`server/http/routes/auth.ts`), so one person guessing passwords would lock everyone out. Read the real client address from the header Replit's proxy sets. Replit's docs do not name it, so log the incoming headers once on a published app to find out, and only trust a value the proxy itself wrote.
2. **Security headers.** `vercel.json` adds `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and `Content-Security-Policy: frame-ancestors 'self'` to every response, and a strict Content-Security-Policy to `/admin`. The Node server sends none of these for the admin's static files. Copy the values from the `headers` section of `vercel.json`.
3. **Port.** Line 67 listens on a fixed port 3000. Either map 3000 to external port 80 in `.replit`, or change it to `process.env.PORT ?? 3000`.
4. **Automatic seeding.** Line 15 loads the repository's seed content whenever the database has no published snapshot. That is harmless for a fresh start, but if you intend to load `exports/production-2026-11-13/content.sql`, load it before the server's first start (step 5).

Also check the old `.html` addresses: `vercel.json` redirects `/index.html` and `/<page>.html` to the clean URLs. The renderer handles the nine club pages itself (`server/render/handler.ts` line 70); confirm that covers what you need.

Finish any code change with `npm run build` and `npm test`, as [AGENTS.md](../AGENTS.md) requires.

### 5. Initialise the database

From the Replit Shell, with the secrets from step 3 available:

```sh
npm run db:migrate   # creates the tables
```

Then **either** let the first start seed the concept content, **or** load the production export first:

```sh
psql -v ON_ERROR_STOP=1 "$DIRECT_DATABASE_URL" -f exports/production-2026-11-13/content.sql
```

Both give the same site, because production was never edited after seeding; see the [export notes](../exports/production-2026-11-13/README.md). Then create your accounts:

```sh
npm run bootstrap    # Owner accounts from ADMIN_BOOTSTRAP_USERS, only when there are no users yet
```

### 6. Publish

A starting point for `.replit`. Check each line against Replit's current docs:

```toml
run = "npm run dev"

[deployment]
build = "npm ci --include=dev && npm run build"
run = "npm run start"

[[ports]]
localPort = 3000
externalPort = 80
```

`npm run start` uses `tsx`, and the build uses `vite` and `typescript`. All three are devDependencies, so the published app must install them; `--include=dev` is there for that. If Replit installs packages its own way, move `tsx` to `dependencies` instead.

After publishing, run the checks in HANDOFF step 7. On Replit, add these:

- `/api/admin/healthz` returns `{"ok":true}`.
- Sign in works, which confirms `PUBLIC_BASE_URL` and `NODE_ENV=production`. **Phil / Phil must be rejected.**
- Response headers on `/` and `/admin` include the security headers from step 4.
- Fail a sign-in from two different networks and confirm the audit log shows two different IP addresses.
- `curl -X POST https://<your-host>/api/shop/checkout` returns 403.

### 7. Daily cron

Create a Scheduled deployment that runs once a day:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/admin/cron/settle
```

It records scheduled publications that have come due, deletes expired sessions and clears abandoned uploads. Scheduled content appears on the public site on time even if the cron is late; the cron does the bookkeeping.

### 8. Domain and going live

Attach the domain under Tools → Domains, then set `PUBLIC_BASE_URL` to the final address and republish. The rest of "Going live on prospector.org" in HANDOFF applies unchanged, including the concept wording, search indexing, and keeping merch checkout disabled.

## Route B: everything on Replit

Do Route A's steps 1, 3, 4, 6, 7 and 8, and replace the two outside services with adapters. This is real development work with tests, not configuration.

### Database adapter

- Only three source files import the Neon driver: `server/store/postgres.ts` (18 lines, creates the connections), `server/store/postgres-store.ts` (types only) and `scripts/db-migrate.ts`.
- Neon's `Pool` follows the interface of the standard `pg` package, so the likely change is to create the pool from `pg` and drop the separate `readQuery` path, which is optional (`PostgresOptions.readQuery`).
- Replit's database does not use TLS, so do not force SSL.
- The SQL in `server/store/postgres-schema.sql` is plain PostgreSQL and loaded cleanly into PostgreSQL 16 during the export test.
- The Postgres test suites (`tests/helpers/postgres.ts`) connect through a Neon WebSocket proxy and will need the same switch. Run the shared Store contract tests against the new adapter before trusting it; they cover concurrency, history protection and rate limits.
- Replit creates a separate production database when you publish. Run `db:migrate`, the content load and `bootstrap` against that one, not only the workspace database.

### Media adapter

- Implement the `MediaStorage` interface (`server/store/types.ts`) on `@replit/object-storage`: `put`, `read`, `delete`, `incoming`, `url`, `clientUpload`. `server/store/blobs/fs.ts` is the closest model; `server/store/blobs/vercel.ts` shows the rules to keep (private only, never overwrite, refuse to delete files retained by history).
- Uploads today go straight from the browser to Vercel Blob. The code already has a second path that sends the file through the server (`PUT /api/admin/media/local-upload`), currently enabled only for the filesystem driver in `server/http/routes/media.ts` and chosen by the `local` flag in `admin/src/state/media.ts`. Enabling that path for the new adapter avoids writing a browser-side uploader.
- Wire the new adapter into `createMediaBlobs` in `server/store/index.ts`, and remove the Vercel Blob hosts from the admin Content-Security-Policy once they are unused.

## If you use Replit Agent

Give it this, and review what it changes:

> Read AGENTS.md, HANDOFF.md and docs/replit-migration.md before changing anything. Follow Route A in docs/replit-migration.md. Create scripts/serve.ts as the production server with the four changes in step 4, point `npm run start` at it, and add a `.replit` file. Do not change the database or media code, do not enable shop checkout, do not weaken sign-in, CSRF or permission checks, and do not commit secrets. Finish with `npm run build` and `npm test` and report what failed or was skipped.

## Costs

Budget for the Replit deployment (Autoscale or Reserved VM), a small Scheduled deployment for the cron, Neon, and Blob storage if used. Route B swaps the last two for Replit's database and App Storage charges. Check current prices with each provider; the figures above are from Replit's pricing page on 2026-11-13.
