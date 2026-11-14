# Production content export, 2026-11-13

`content.sql` is the content of the hosted demo (https://prospector-soccer-redesign.vercel.app) as of 2026-11-13 17:45 PST, taken from a read-only snapshot of the production Neon database. The deployment was running commit `68a840f` at the time.

It is a **content-only** export, made on purpose so it can live in a public repository. AGENTS.md says never to commit database dumps; that rule is about dumps holding accounts and secrets, and this file holds neither.

## What is in it

Plain SQL (`COPY` data only, no schema) for four tables:

| Table | Rows | Holds |
| --- | ---: | --- |
| `docs` | 145 | Every page and record, draft and published, across 24 collections |
| `revisions` | 290 | Per-item history |
| `publishes` | 2 | Site versions 1 and 2 |
| `snapshots` | 1 | The published site (site version 2) |

## What is not in it

- `users`, `sessions`, `rate_limits`, `audit` and `meta`: accounts, password hashes, sign-in sessions, login locks, the activity log and operational caches. Create your own accounts with the bootstrap step below.
- Uploaded media. There was none: all 26 media records point at images shipped in `public/assets/`.

Every record in the export was created by the seed scripts (`Content migration` and `Store showcase seed`); nobody had edited content through the admin. A database initialised with `npm run seed` therefore gives you the same site, and loading this file is only needed if you want the exact production rows and history.

## Loading it

Load into a **new, empty** PostgreSQL database, in place of `npm run seed`. Do not run `npm run seed` as well.

```sh
npm run db:migrate                                   # creates the tables
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f exports/production-2026-11-13/content.sql
npm run bootstrap                                    # creates your Owner accounts from ADMIN_BOOTSTRAP_USERS
```

`db:migrate` and `bootstrap` need the environment described in [HANDOFF.md](../../HANDOFF.md) steps 4 to 6. Expect 145 / 290 / 2 / 1 rows afterwards. History entries show the author id `seed` because the original accounts are not included.

The file was dumped by PostgreSQL 18.7. Three lines that older tools reject (`\restrict`, `\unrestrict` and `SET transaction_timeout`) were removed; nothing else was changed. The load was tested against an empty PostgreSQL 16 database with the schema from `server/store/postgres-schema.sql`.

## Hosting somewhere other than Vercel (for example Replit)

Not tested. Two things to know before you start:

- The database adapter uses Neon's serverless driver (`@neondatabase/serverless`), not a generic PostgreSQL client. It needs a Neon-compatible connection string.
- Media uploads use a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). The shipped images work without it; uploading new media does not.

See "Other Node hosts" in [HANDOFF.md](../../HANDOFF.md#running-it).
