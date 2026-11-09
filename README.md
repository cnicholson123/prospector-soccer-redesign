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
