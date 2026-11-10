# Handoff: Prospector Soccer Club website

Written for Phil, who is taking over this repository and will host it under his own accounts. Nothing here depends on the previous owner's deployment bot, Vercel team, AI agents or secrets. Everything you need is in this repository plus your own GitHub, Vercel and Neon accounts.

The site is a redesign of the Prospector Soccer Club website with a built-in content management system (the "admin") for club volunteers. The previous owner's demo is at https://prospector-soccer-redesign.vercel.app. It is presented as a **redesign concept**: imagery is illustrative, search-engine indexing is off, and the merchandise store is a browsable proof of concept whose **checkout must stay disabled**. TeamSnap remains the club's registration system.

Where to look next:

- [docs/admin-manual.md](docs/admin-manual.md): how volunteers edit, preview and publish. Give this to editors.
- [AGENTS.md](AGENTS.md): operating rules for AI coding agents (and a good orientation for you).
- [README.md](README.md): architecture, testing, operations runbook (backup, restore, unlock, secret rotation).
- [README-deploy.md](README-deploy.md): deeper storage, upload-protocol and recovery detail. It was written during development and still refers to the previous owner's accounts in places; this file is the authoritative setup guide.
- `plans/`: development history, including superseded decisions. Current code and tests win over anything in there.

## What you are receiving

- Eight public club pages (home, recreational, competitive, referees, sponsors, board, resources, about) plus the merchandise showcase, cart and a checkout page that explains orders are not accepted.
- An admin at `/admin` with drafts and autosave, private previews at phone/tablet/desktop widths, click-to-edit on the live design, publish and schedule, review requests, per-item and whole-site history and restore, a media library with verified uploads, an audit log and role-based accounts.
- Starter content in `content/seed/`: 145 published records across 24 collections, including 26 "static" media records that point at images shipped in `public/assets/`. It is a snapshot of concept content, not a promise that fees, dates, people or links are current.
- Three Vercel functions in `api/` (`render`, `admin`, `shop`), server code in `server/`, the shared content schema in `shared/schema.ts`, the Preact admin in `admin/`, and tests in `tests/` (eight public HTML goldens protect the club-page design).
- Two storage drivers behind one `Store` interface: filesystem (local development and tests) and Neon Postgres plus private Vercel Blob (hosting). There is no other database option without new adapter code.

What the repository does **not** contain: the current database, uploaded media binaries, hosting accounts, DNS access, or any secrets. See "Bringing over existing content" if you want the current content rather than the seed.

## Try it locally first (15 minutes)

Use Node **22.12 or later in the 22.x line** and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

- Public site and API: http://localhost:3000. Hot-reloading admin: http://localhost:5173/admin/.
- The first start seeds an empty filesystem store under `DATA_DIR` (`.data` by default) with the repository content.
- Sign in with the development fallback account **Phil / Phil**. It exists only because `.env.example` leaves `ADMIN_BOOTSTRAP_USERS` unset and `ADMIN_BOOTSTRAP_PASSWORD` blank; the server fills in `Phil` for both. It is never available in production.
- A built local run is `npm run build` then `npm run start`, with the admin at http://localhost:3000/admin.

To practice with real-style accounts locally, follow "Create your Owner accounts" below, put the JSON into `.env`, delete the practice `DATA_DIR` (or point `DATA_DIR` at a new folder), and start again. Accounts are created only when the user table is empty, so changing `ADMIN_BOOTSTRAP_USERS` after the fact does nothing to existing accounts.

Checks that should pass before you deploy:

```sh
npm run build
npm test
npm run check-facts
```

`npm test` runs the filesystem suites. Postgres and Blob suites print **not run (no env)** when their credentials are absent, which is expected locally. `npm run test:e2e` drives the built site with installed Google Chrome; run it from a normal terminal with port 3000 free.

## Stand it up on your own accounts

### 1. Accounts you need

- A GitHub repository you control (fork this one or push it to a new club-owned repository).
- A Vercel account or team and a project in it.
- A Neon account and project (directly, or through the Vercel Marketplace integration).
- A **private** Vercel Blob store connected to the project.
- Later, for go-live: access to the DNS for `prospector.org`.

Volunteers only need admin accounts inside the site. They never need GitHub, Vercel or Neon access.

### 2. Create the Vercel project

Import your repository into a new project in **your** Vercel account. Settings:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Node.js version | 22.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `public` |

Keep `vercel.json`. It routes public pages, `/media`, `/admin` and the APIs to the three functions, attaches the common-password list each function needs at runtime, sets security headers, pins the function region and declares the daily cron job. `public/admin/` is generated by the build.

The first deployment will build but show "Content is not initialized" until you finish the steps below. That is expected; redeploy after configuring the environment and seeding.

**Region.** `vercel.json` pins functions to `pdx1` (Portland, US West). Put the functions in the region closest to your Neon database: for a Neon project in AWS `us-west-2` (Oregon), `pdx1` is right. If you create the database elsewhere, change `regions` in `vercel.json` to match (see [Vercel's region list](https://vercel.com/docs/functions/configuring-functions/region)). Admin latency depends heavily on this.

### 3. Create the database and Blob store

**Neon.** Create a project and database. Copy the **pooled** connection string (the host contains `-pooler`) for `DATABASE_URL`; the app uses Neon's serverless driver over HTTP/WebSocket and expects TLS. Keep the **direct** (non-pooled) connection string handy for `pg_dump` / `pg_restore`. Use a separate Neon branch or database for Preview deployments so previews never write to production data.

**Blob.** Create a Vercel Blob store with **private** access and connect it to the project. Vercel injects `BLOB_READ_WRITE_TOKEN` for the environments you select. A public Blob store is not supported: the app streams every file through its own `/media/...` URLs after checking that the file is published or the viewer is signed in. Use a separate store for Preview if you want previews isolated.

### 4. Create your Owner accounts

Accounts are seeded from `ADMIN_BOOTSTRAP_USERS`, a JSON array of users with pre-hashed passwords. Generate each hash locally:

```sh
npm run hash-password
```

Type the password at the hidden prompt (or pipe it in from a password manager). The output is a scrypt hash that is safe to store in an environment variable. Never put the plaintext password in a command argument, file, screenshot or chat.

Shape of the value (one line; in the Vercel dashboard paste the JSON array without the surrounding single quotes):

```dotenv
ADMIN_BOOTSTRAP_USERS='[{"username":"phil","displayName":"Phil","role":"Owner","passwordHash":"<hash>"},{"username":"club-backup","displayName":"Club backup owner","role":"Owner","passwordHash":"<another hash>"}]'
```

Rules the server enforces when it loads the value: 1 to 100 entries, usernames of letters, digits, `_ . @ -` only and unique case-insensitively, roles among `Owner | Admin | Editor | Contributor | Viewer`, at least one Owner, and hashes in the exact format `hash-password` prints. A second Owner the club controls is strongly recommended so one lost password cannot lock everyone out.

How bootstrap behaves:

- It runs when you execute `npm run bootstrap` and also automatically on the first admin request after deployment.
- It creates accounts **only when the user table is empty**. Editing the variable later does not change, add or remove existing accounts; use **Users** in the admin for that.
- Bootstrap accounts sign in with the password you hashed and are never forced to change it. (`ADMIN_FORCE_PASSWORD_CHANGE` only affects the development plaintext fallback account; leave it `false`.)
- Accounts created or reset through **Users** get a generated temporary password shown once, and must choose a different password at first sign-in before they can do anything else. The server requires at least 10 characters, not the username, not a common password, and different from the current password.
- The variable is **required** in production even on a database that already has users (the server refuses to start without a valid value), so always set it.

### 5. Environment variables

Set these in Vercel for Production and Preview. Vercel sets `NODE_ENV=production` for both, so Preview needs the full production set too (with its own Neon branch, Blob store and `PUBLIC_BASE_URL`). The server validates the configuration on startup and fails fast with a `Configuration:` error if a production requirement is missing.

| Variable | Production value | Notes |
| --- | --- | --- |
| `STORE_DRIVER` | `postgres` | Defaults to `postgres` when `NODE_ENV=production`; set it explicitly anyway |
| `DATABASE_URL` | Neon pooled TLS connection string | Required with `postgres` |
| `BLOB_READ_WRITE_TOKEN` | Token for your private Blob store | Injected by the Blob integration |
| `SESSION_SECRET` | Random string of at least 32 bytes | `openssl rand -hex 32`. Signs upload tickets. Required in production |
| `CRON_SECRET` | A different random string | `openssl rand -hex 32` again. Vercel sends it as `Authorization: Bearer` to the cron route. Required in production |
| `ADMIN_BOOTSTRAP_USERS` | JSON array from step 4 | Required in production |
| `ADMIN_FORCE_PASSWORD_CHANGE` | `false` | Only affects the development fallback account |
| `PUBLIC_BASE_URL` | Exact HTTPS origin, for example `https://your-project.vercel.app` | No path, query or trailing slash. Must be HTTPS in production. Used for links, sitemap and Origin checks; sign-in fails if it does not match the address in the browser |
| `COOKIE_SECURE` | `true` | Required in production |
| `CACHE_SMAXAGE` | `15` | CDN freshness for club pages, seconds (production default) |
| `CACHE_SWR` | `300` | Stale-while-revalidate window for club pages, seconds (production default) |
| `CDN_PURGE` | `tag` | Purge cached pages and media by tag on publish. `off` disables purging |
| `TZ_NAME` | `America/Los_Angeles` | Club time zone for dates and schedules |
| `MAX_IMAGE_BYTES` | `8388608` | 8 MiB per original image (default) |
| `MAX_FILE_BYTES` | `15728640` | 15 MiB per PDF (default) |
| `MAX_UPLOAD_BYTES_PER_DAY` | `268435456` | 256 MiB reserved per user per rolling 24 hours (default) |
| `SHOP_CHECKOUT` | `disabled` | Default. The server refuses `enabled` unless `NODE_ENV` is `development` or `test` |

`DATA_DIR` is only for the filesystem driver and is ignored in production. Nothing is exposed to the browser through `VITE_*` variables; keep it that way. Changing any variable requires a new deployment.

### 6. Initialize the database

Run these from your own machine with the production values loaded into your shell (or a local `.env` that is gitignored and that you delete afterwards). They are operator commands, not build steps, and they need `STORE_DRIVER=postgres`, `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_BOOTSTRAP_USERS`, `PUBLIC_BASE_URL` (HTTPS) and `COOKIE_SECURE=true` present, plus `NODE_ENV=production` so the production validation matches what Vercel will run.

**Fresh start with the repository's concept content:**

```sh
npm run db:migrate   # creates the tables; transactional and safe to repeat
npm run seed         # loads all 145 records and publishes site version 1
npm run bootstrap    # creates your Owner accounts (empty user table only)
```

Then redeploy (or open the site) and sign in at `/admin`.

The additive commands `npm run seed:store` (merchandise records) and `npm run seed:media` (static image records) exist for databases that were initialized before those records were part of the main seed. On a database seeded today they report `0 created` and change nothing. They never overwrite existing records.

**Rules that keep your data safe:**

- `npm run seed` is for a **new, empty** database only. Against a database with edits it refuses to run; `npm run seed -- --force` overrides that and replaces live content with repository content. Never run either against your live database.
- Normal code deployments need no reseed. Run `npm run db:migrate` only when a release changes `server/store/postgres-schema.sql`; it is idempotent.
- `seed:store` and `seed:media` are safe to rerun; they take no arguments and only add missing records.

### 7. Deploy and verify

Deploy from Git (push to the production branch) or, if you prefer the Vercel CLI, sign in to your own account, `vercel link` the project, then `vercel` for Preview and `vercel --prod` for Production. The CLI is not a project dependency. Keep `.vercel/` and pulled environment files out of Git.

Check on the deployed URL:

- Every public page loads, and the navigation shows **Merch (concept)**.
- `/api/admin/healthz` returns `{"ok":true}` (routing works; it does not test the database).
- `/admin` sign-in works with your Owner account, and **Profile** lets you change the password.
- Make a reversible edit, preview it at the three widths, publish it, and confirm the public page updates. The publish toast says "Live now" when the CDN purge succeeded.
- Upload an image and a PDF in **Media**, place the image on a page, publish, and open the image URL in a private browser window (published media is public; drafts require sign-in).
- **History → Site versions → Compare with current** shows your publication.
- `/shop/checkout` has no form, and `curl -X POST https://<your-host>/api/shop/checkout` returns HTTP 403 with `{"error":"checkout_disabled"}`.

### 8. Cron

`vercel.json` schedules `GET /api/admin/cron/settle` at `0 8 * * *` (08:00 UTC daily). Vercel calls it with `Authorization: Bearer <CRON_SECRET>`; the route accepts GET or POST and rejects anything else with 401. Each run:

- settles scheduled publications that have come due and records them in history (the public renderer already shows due content on its own; cron just records the settlement),
- deletes expired sessions,
- removes unfinished uploads older than 24 hours and retries up to 100 pending cleanup intents.

On the Vercel Hobby plan, cron jobs run at most once a day and may run at any point within the scheduled hour; that is sufficient here. Check the cron job's invocation log in the Vercel dashboard after the first scheduled run. If Vercel changes how cron jobs are configured in the future, that is a small, separate change to `vercel.json`.

## Bringing over existing content

If you want the content currently on the owner's deployment instead of the seed, you need two things from the current owner: a PostgreSQL dump and copies of any uploaded media binaries. The repository has no cross-account export or import tool, so this is a manual procedure. Do it **before** running `npm run seed` on your database (seed is for an empty database).

### What to ask the current owner for

1. **A database dump** in custom format, taken with the direct (non-pooled) Neon connection string:

   ```sh
   pg_dump --format=custom --no-owner --no-acl --file=prospector.dump "$DIRECT_DATABASE_URL"
   ```

   It contains all content, drafts, revisions, publications, snapshots, the audit log, **user accounts with password hashes**, sessions and rate-limit state. Treat it as a secret: transfer it over an encrypted channel and delete copies when done.

2. **Your own Owner account inside the dump.** Phil already has an Owner account (username `Phil`) on the current deployment, so this is already satisfied. Before the dump is taken, sign in to the current deployment and change your password in **Profile** to one only you know (the current one was chosen by the previous owner). Your account and password hash then travel inside the dump, so you can sign in to your own deployment immediately. Anyone else who needs access later can be added from **Users → Add user**. (Bootstrap will not help after a restore: it only creates accounts when the user table is empty.)

3. **The git commit** the owner's deployment was built from, so your first deployment matches the schema of the dump. Any later commit on `main` is fine as long as you run `npm run db:migrate` afterwards.

4. **Uploaded media files**, if the library contains any uploads (as opposed to the shipped static images). Uploaded files live in the owner's private Blob store under paths like `media/<yyyy>/<mediaId>/original.<ext>` and `media/<yyyy>/<mediaId>/web.webp`. The database refers to them as `/media/media/<yyyy>/<mediaId>/...`. Ask for every object under `media/` as files that keep their exact path, including older versions still referenced by history. The static seed images (`/assets/...` URLs) are in Git and need nothing.

### Restore into your Neon database

Use PostgreSQL client tools at least as new as the owner's server (Neon runs current major versions). Point them at the **direct** connection string of a **new, empty** Neon database.

```sh
pg_restore --no-owner --no-acl --dbname="$DIRECT_DATABASE_URL" prospector.dump
npm run db:migrate   # with DATABASE_URL (pooled) pointing at the same database; no-op if the schema is current
```

A notice that schema `public` already exists is harmless. Then, connected with `psql` to the same database, drop the old sessions and rate-limit state so no browser session from the old deployment carries over and no stale login locks apply:

```sql
DELETE FROM sessions;
DELETE FROM rate_limits;
```

Optional: list the uploaded media paths you must copy into your Blob store.

```sql
SELECT DISTINCT v.value AS url
FROM docs d, jsonb_each_text(coalesce(d.body->'published'->'variants', '{}'::jsonb) || coalesce(d.body->'draft'->'variants', '{}'::jsonb)) v
WHERE d.body->>'collection' = 'media' AND v.value LIKE '/media/media/%'
UNION
SELECT DISTINCT v.value
FROM revisions r, jsonb_each_text(coalesce(r.body->'data'->'variants', '{}'::jsonb)) v
WHERE r.body->>'collection' = 'media' AND v.value LIKE '/media/media/%';
```

Strip the leading `/media/` to get each Blob pathname. Upload every file into your private store at exactly that pathname (with `@vercel/blob`'s `put(pathname, data, { access: 'private', addRandomSuffix: false })`, or any tool that preserves pathnames). Verify a few originals, web variants and an older version from history load through your deployment before adopting the import.

### After the import

- Deploy with **your** environment (step 5) and sign in with your existing `Phil` Owner account (the password you set before the dump).
- In **Users**, deactivate the previous owner's accounts and any volunteer accounts that should not carry over. You must be an active Owner yourself first; the last active Owner cannot be removed.
- Reset passwords for volunteers who continue, or ask them to change their own in **Profile**.
- Secrets that must **not** be reused from the old deployment: `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, the owner's `ADMIN_BOOTSTRAP_USERS` value (it contains their hashes; set your own as in step 4, even though it will not run), and any Vercel or Neon API tokens. Generate fresh values for everything.
- Skip `npm run seed`. Use `seed:store` / `seed:media` only if the owner's database predates those records and the commands report missing ones.

## Going live on prospector.org

1. Have the club approve the content, imagery and launch. Check registration dates, fees, contacts, documents, sponsor permissions and that every registration link points at the club's TeamSnap pages.
2. In the Vercel project's Domains settings add `prospector.org` and, if used, `www.prospector.org`. Pick one canonical host and let Vercel redirect the other.
3. At the current DNS provider add the exact records Vercel shows. Keep existing MX, SPF, DKIM, DMARC and any other club records. Agree a cutover window and keep the old host available for rollback.
4. Set Production `PUBLIC_BASE_URL` to the canonical origin (for example `https://prospector.org`), keep `COOKIE_SECURE=true`, redeploy, and sign in again on the new host. Sessions are tied to the host: the production cookie is `__Host-psc_session` (Secure, HttpOnly, SameSite=Lax), so a session on the `.vercel.app` host does not carry over.
5. In **Site settings → Utility Bar**, replace the **Pill Text** (`Redesign concept`) and the two message fields with approved wording, or untick **Enabled**. The utility bar also carries the public **Admin** link, so if you disable it tell editors to bookmark `/admin`. **Banner** is the separate announcement strip.
6. In **Site settings → Search engines**, tick **Indexable** only when the club is ready for search engines, then review and publish the settings. Check the `robots` meta tag, `/robots.txt` and `/sitemap.xml` on the final domain.
7. The footer line "Redesign concept · imagery generated with GPT Image, illustrative only" is hard-coded in `server/render/templates/layout.ts` and the shop carries its own proof-of-concept notices. Changing those is a code change (the public goldens in `tests/golden/` will need a reviewed update). Decide this with the club before launch.
8. Verify HTTPS, both host redirects, registration links, media, sign-in, publish and the next cron run on the final domain.

## Running it

The [README operations section](README.md#operations) has the runbook. In brief:

- **Backups.** Nothing in the repo schedules them. Use Neon's point-in-time restore and take your own `pg_dump --format=custom --no-owner --no-acl` regularly with the direct connection string. Keep the private Blob store's contents too: a database restore does not bring back missing files. Admin content exports (JSON) are for inspection, not recovery.
- **Code rollback.** Vercel's Instant Rollback switches application traffic only; it does not touch the database or Blob. Content undo is **History → Site versions → Restore site to this version** (Owner only).
- **Locked account.** `npm run unlock -- <username>` with the production environment loaded clears that user's login locks (audited). Password resets are done by an Admin/Owner in **Users**; there is no email reset.
- **Rotate secrets.** New `SESSION_SECRET` (in-flight upload tickets must be retried), new `CRON_SECRET`, new Neon/Blob credentials from their dashboards; redeploy after each change. Sessions are opaque tokens stored in the database, so rotating `SESSION_SECRET` does not sign anyone out; use **Sign out everywhere** in Users or Profile for that.
- **Other Node hosts.** `npm run start` runs a plain Node HTTP server (`scripts/dev.ts --built`) on port 3000, but it trusts the socket peer for IP limiting, has no TLS or process supervision, and the Postgres adapter uses Neon's driver (not a generic PostgreSQL connection). Moving off Vercel is an adaptation project, not a setting. Filesystem storage needs a persistent disk, so it is unsuitable for serverless hosts.

## Costs and plan choice

Vercel Hobby is for personal, non-commercial use. Check whether the club's use, fundraising or any future sales fit its terms, and pick the plan Vercel confirms is appropriate ([Hobby terms](https://vercel.com/docs/plans/hobby)). Budget separately for Vercel compute and bandwidth, Neon compute, storage and restore retention, Blob storage and transfer, the domain, and backups. Set usage alerts rather than assuming a fixed monthly total ([Vercel pricing](https://vercel.com/pricing), [Neon plans](https://neon.com/docs/introduction/plans), [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)). Admin accounts for volunteers cost nothing; they are application accounts, not Vercel seats.

Merch checkout stays disabled. Real orders, payment, confirmations, fulfillment and inventory would need new implementation and review.

## Known limitations

- Very fast repeated `[` / `]` presses (previous/next item) before the next editor has rendered can be ignored, and pressing Enter in the command palette in the same instant its results update can occasionally need a second press. Pause briefly and repeat.
- Editing presence ("No other editors seen on this server") is advisory and per server instance. Heartbeats are at most every 30 seconds and entries expire after 75 seconds. Another instance or a restart can hide someone; version checks still prevent overwriting each other's saves.
- Save conflicts are resolved explicitly (**Discard mine** / **Keep mine (overwrite)**). There is no automatic per-field merge.
- Upload verification checks size, file signatures and image dimensions and requires a browser-made WebP of at most 2000px. It does not decode every pixel, bound animation frames, or scan for malware. Animated images keep their original with a still WebP preview.
- Warm admin reads are write-free, but cold starts, due schedules, the 15-minute session refresh, 10-minute maintenance claims and expired health caches can write.
- Published media is cached `s-maxage=300, stale-while-revalidate=60`; club pages use the configured 15/300 seconds. Publishing purges both by tag when `CDN_PURGE=tag`. If the purge fails the toast says "Live within about 5 minutes"; allow about six for media. Downloaded copies cannot be recalled.
- Per-user upload quota reserves bytes when a ticket is issued, including abandoned uploads. Historical verified files are kept forever; there is no garbage collector for them.
- Password resets are administrator-assisted. Media revisions cannot be restored through generic history; use **Replace file**. Whole-site restore keeps referenced historical files.
- The Documents list still shows the stale helper text "File uploads arrive in Phase 10". Uploads work from the document editor.
- The previous owner's checks on real Neon, Blob, purge and cron were done on their accounts; verify them on yours before relying on them.

## Checklist

- [ ] Local run works and `npm run build && npm test && npm run check-facts` pass.
- [ ] Vercel project, Neon database (Production and Preview) and private Blob store created under your accounts; function region matches the database.
- [ ] Fresh `SESSION_SECRET`, `CRON_SECRET` and your own `ADMIN_BOOTSTRAP_USERS` with two Owners; `SHOP_CHECKOUT=disabled`.
- [ ] Database initialized (seed) or imported (restore, migrate, sessions cleared, Blob files copied, old accounts deactivated).
- [ ] Deployed and verified: pages, health, sign-in, publish, media, history, checkout 403, cron run.
- [ ] Volunteers added with the least role they need; each has read the [manual](docs/admin-manual.md).
- [ ] Backups scheduled and a restore tested on a scratch database.
- [ ] Launch decisions made: utility bar text, indexing, hard-coded concept footer, domain cutover window.
