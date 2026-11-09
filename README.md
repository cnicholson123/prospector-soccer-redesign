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
