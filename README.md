<img src="assets/img/crest-sm.png" width="64" alt="">

# Prospector Soccer Club — website redesign concept

A modernized, mobile-first redesign of [prospector.org](https://prospector.org) (Prospector Soccer Club, Cameron Park / Shingle Springs / Rescue, CA). All content from the current site is carried over; imagery is newly generated with GPT Image and is illustrative only.

**This is a redesign concept, not the official club website.**

## Structure

- `content/content.md` — content inventory captured from prospector.org (source of truth for facts, fees, names, links)
- `src/layout.html` — shared header, mobile menu and footer
- `src/pages/*.html` — page bodies (each starts with a `<!--meta {...} -->` JSON header)
- `assets/` — CSS design system, vanilla JS enhancements, images
- `build.py` — wraps pages in the layout and writes the static site to `docs/` (served by GitHub Pages)

## Build

```sh
python3 build.py
open docs/index.html
```

No dependencies. Upcoming events dim automatically once their date passes, and the season timeline places "today" from the visitor's clock.

## Local CMS development

The admin CMS migration uses Node 22.12 or newer and the filesystem store locally.

```sh
npm ci
npm run build
npm test
npm run check-facts
npm run start
```

`npm run start` seeds an empty `DATA_DIR` and serves the built app on localhost:3000. `npm run dev` also starts Vite on localhost:5173. See `.env.example` for configuration. Production requires explicitly configured bootstrap credentials and a session secret. Metadata drivers are `fs` and `postgres`, with the Postgres implementation scheduled for Phase 6. Blob storage is reserved for media.

Both Vercel entrypoints default-export an object with a Web-standard `fetch(Request)` method. `api/render.ts` delegates to `renderPublic` and `api/admin.ts` delegates to the Hono app. Local tests dispatch through this same object shape.

Filesystem mutations journal history and audit before the document commit. Publish journals preserve the full intended snapshot and commit it last. After an interrupted publish, `Store.recoverPublish()` resumes the pending transaction idempotently. The filesystem lock recovers dead owners and renews its lease during active writes. Implementation status and phase-specific verification are recorded in `plans/admin-progress.md`.

## Local admin API (Phases 4–5)

Run `npm run bootstrap` to create the first Owner if the store has no users. Development defaults are Phil / Phil; production requires explicit `ADMIN_BOOTSTRAP_USER` and `ADMIN_BOOTSTRAP_PASSWORD`. Bootstrap never replaces an existing user. `POST /api/admin/auth/login` returns `csrfToken`, `passwordWeak`, public user details, and permissions. Retain its `psc_session` cookie and send `X-CSRF-Token` plus the site Origin on writes. Password changes rotate the session; role changes, resets and deactivation revoke sessions.

The backend now supports users, sessions, audit CSV/JSON streams, documents, revisions, publish/unpublish, schedules, search, dashboard health, and JSON content export. The admin SPA remains the branded scaffold until Phase 7a; login/profile screens, the prominent weak-password banner, DiffView and the public Admin link are not implemented by Phases 4–5. Their API data and server enforcement are ready.

Write contracts intentionally require the version the editor saw:

- Create: `POST /docs/events` with `{ "draft": { "title": "Club meeting", "date": "2027-01-10" } }`.
- Save: `PUT /docs/events/:id` with `{ "baseVersion": 1, "draft": { ... }, "checkpoint": true, "summary": "Optional checkpoint note" }`. Omit `checkpoint` for coalesced autosaves.
- Reorder: `POST /docs/:collection/reorder` with `{ "items": [{ "id": "...", "baseVersion": 1 }, ...] }`, containing every active item. Changed orders commit atomically with one audit record and no new content revisions.
- Publish/unpublish/schedule: `{ "items": [{ "collection": "events", "id": "...", "expectedVersion": 2 }] }`; schedule also requires an ISO `at` with timezone. `all: true` still requires the complete versioned selection, preventing blind publication of intervening edits.
- Trash, untrash, review, cancel schedule, and revision restore require `baseVersion`. Revision restore also accepts `publish: true`; supply `?docId=...` for direct revision lookup.
- A 409 returns `error.details.current` and “Someone else saved this. Reload and compare”. The Phase 7a client must show the local/server diff. “Discard mine” uses the server copy; “Keep mine” resubmits against that copy’s version with `checkpoint: true`, producing a new revision. No automatic field merge is used.

Schedules freeze the selected draft and order. Public renders apply due schedules before cron settlement, and disable SWR around the next due boundary. Settlement retains later draft edits and records `effectiveAt`. `GET` (Vercel cron) and `POST /api/admin/cron/settle` require `Authorization: Bearer <CRON_SECRET>`; Editor+ requests also settle due items. Canceling, unpublishing, restoring and rebuilding all create kind-tagged site records through `Store.publish`. Interrupted transactions recover through `Store.recoverPublish`.

The FS adapter additionally serializes account changes, bootstrap, maintenance claims and lockout counters. `mutateDoc` has `relatedOrder` and `guardVersions` metadata options so multi-item reorder uses its existing durable journal. `publishedOrder` retains the live order until the reordered document is explicitly published. Phase 6's Postgres adapter must implement these additions to the Store contract.

`npm run test:e2e -- --list` lists the browser specs without launching Chrome. Browser execution is not supported inside the Codex sandbox; run `npm run test:e2e` outside it. The Phase 4/5 spec tests API authentication plus responsive preview at 390 and 1280 pixels. The full keyboard/login/editor flow belongs to Phase 7a.
