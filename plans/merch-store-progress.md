# Merch store progress

Implements `plans/merch-store-plan.md`, with the admin architecture and amendments in `plans/admin-plan.md` and prior work in `plans/admin-progress.md`. This is the progress filename explicitly requested for this run; the plan's references to `merch-progress.md` point to this log instead.

## CHANGELOG — Phase 1: Catalog foundation — 2026-11-09

Shipped

- Schema version 2; additive exact-dollar fields, slug controls, three-decimal tax-rate fields, optional snapshot `media.small`, shop FAQs, `PageName.shop`, and all five catalog/settings/page collections. Existing money fields retain their range behavior. Catalog drafts accept partial content; publication requires complete fields, stable variant keys, unique labels/slugs, valid windows, published bundle components, valid fixed selections, and contact/payment/fulfillment settings before enabling the store. Validation runs inside the existing publication transaction for both store adapters, with document paths on rejection.
- Ten concept products, five categories, three bundles and four shop FAQs are drafts. Shop page and disabled store settings are published. Ten static media records describe all twenty existing WebP assets: 1200×1200 web images and 480×480 small variants. Descriptions, details, supplier estimates and prices come from the supplied lookbook source. Supplier information never appears in storefront HTML or quote responses. Pickup remains an inactive placeholder requiring deliberate confirmation before enabling the store.
- Draft-aware, idempotent seeding; the complete fixture now has 145 documents and 123 published records. Snapshot/revision/audit/restore behavior remains the content system's existing implementation.
- Pure integer-cent pricing and availability: youth/override precedence (including zero prices), bundle fixed selections and fixed prices, canonical deduplication, cumulative component stock/caps, preorder windows, stock and waitlist states, quantity corrections, pickup-only problems, discounts, shipping thresholds and tax rounding. The only dollar-to-cent multiplication in `server/shop/` is `pricing.toCents()`.
- Four role-table actions, including Editor+ order viewing/fulfillment and Admin+ order/store management; store settings have the existing site-settings edit ceiling. Generic admin Store navigation and Shop page entry, exact-price/slug controls, catalog image selection from existing media, and an additive Generate variants panel with fresh stable keys and preserved existing rows. Styling uses the existing admin tokens and components.

Acceptance and verification

- `DATA_DIR=.cache/merch-walkthrough-local STORE_DRIVER=fs npm run seed` — PASS, 145 documents. Repeating the command — PASS, `Seed unchanged: 145 documents`.
- FS HTTP tests create/edit/private-preview/publish a product and bundle; publishing a bundle with an unpublished component returns 422 with its component path; publication of the component and bundle together succeeds. Viewer/Contributor receive 403 on a stub route guarded by `orders.view`; all five roles are table-tested.
- Pricing, availability, validation, image dimensions/size, generator and render regressions are included under `tests/shop/`.
- `npm run build` — PASS. `npm test` — PASS, 598 tests with 17 explicit hosted-service skips, including all eight unchanged golden comparisons and `check:runtime` for all three entrypoints. Final verification is shared with Phase 2 below.
- Real Neon/Postgres and Vercel Blob — **not run (no env)**. No dependencies, package/lockfile entries, golden fixtures or original public CSS/assets were changed.

## CHANGELOG — Phase 2: Storefront and cart — 2026-11-09

Shipped

- Server-rendered landing, product, bundle, category, cart, checkout, lookup and a future status shell in the specified `server/render/shop/` layout. Catalog templates include responsive WebP sources, variants grouped into labelled radio controls, color selection, quantity controls, galleries, details/size guidance, availability, related products, bundle savings, FAQs and editable shop copy. Partial drafts render safely and cannot be purchased.
- Store-disabled 404s, optional coming-soon content, authenticated no-store draft preview, preview-preserving shop links, conditional navigation/cart entry and conditional sitemap URLs. Status-token URLs deliberately remain uniform private 404s until Phase 3 implements order access.
- Layout asset options leave disabled-store public HTML unchanged under all eight goldens. Store CSS uses the existing navy/blue/gold/cream tokens and font families. Catalog pages use `s-maxage=15, stale-while-revalidate=60`, bounded around scheduled publications, and content/shop tags. Cart, checkout, lookup and status/error routes are no-store; sensitive routes use no-referrer/noindex. Added `tagShop`/`purgeShop`, local routing and Vercel rewrites.
- Third function `api/shop.ts`, with Web-standard `fetch` export, quote/availability routes, strict Origin/content-type/body/input guards, store-backed hashed-IP limits, signed checkout tokens, and the explicitly temporary read-only in-memory stock adapter. `check:runtime` imports/packages all three functions and gets a 200 empty-cart quote using authenticated preview without enabling the published seed.
- Plain ES2020 cart client: resilient localStorage identities, server-only pricing, shared drawer/full-page lines, quantity/removal, native modal focus containment/Escape/focus return, live announcements, cross-tab refresh, stock refresh, checkout double-submit prevention and 409 recovery. It clears the cart only on a confirmed 201 response. Header cart enhancement also works on enabled non-shop pages; those pages load drawer CSS only when the drawer opens. No shop asset is emitted on ordinary pages while the seed's store is disabled.
- Checkout form and client speak the Phase 3 contract. Actual order creation, ledger/reservations, payment providers, lookup and order status remain future phases. Today a checkout submission clearly says ordering is not open and preserves the cart. The full order/payment/pickup browser slice is therefore not claimed.

Acceptance and verification

- Final `npm run build` — PASS (Vite and both strict TypeScript configurations).
- Final `npm test` — PASS, 598 tests, 17 skipped hosted checks; eight original golden files untouched. Plain Node ESM packaging on local Node v25.9.0 checks admin/render/shop entrypoints and the authenticated empty-cart quote. Explicit `.js` server imports retained.
- `npm run check-facts` — PASS, 122 inventory facts. `git diff --check` — PASS.
- `npm run test:e2e -- --list` — PASS, 33 tests in nine specs. New shop specs cover 390/820/1280px storefront→cart→checkout, persistence, the current checkout boundary, keyboard/focus flow, mocked 409 recovery and admin variant generation. Browser execution, screenshots, visual/design review and Lighthouse scores — **not run (sandbox)**. Claude must run installed Chrome afterwards. No viewport walkthrough is claimed from HTTP tests.
- Local HTTP walkthrough on the built dev server — PASS: disabled `/shop` 404; authenticated preview 200/no-store; explicit local publication enables landing/product/bundle/category, each 200 with the specified 15/60 cache policy; cart/checkout/lookup 200/no-store; product HTML contains variant radios; Youth M ×1 + Adult L ×2 quotes at 14,500 cents. The temporary server was stopped and its isolated fixture removed.
- `node --check public/assets/js/shop.js` — PASS. Existing installed esbuild was used only to measure the ES2020 minified-equivalent client: below the 12,288-byte limit. All ten small WebPs are ≤50 KiB and have verified 480×480 dimensions. No dependency was added for measurement.
- Real Neon/Blob — **not run (no env)**. Real Stripe, email, deployment and Phase 3+ operations — not run/out of scope. No commit, push, deployment or global configuration edits were made.

Integration notes and remaining gates

- Updated pre-store test assumptions for schema version, page count and draft-aware seed/manifest counts. Limited Vitest to four workers to prevent excessive concurrent filesystem fixture writes; retained all assertions and provided 15-second allowances for three larger existing FS workflows.
- Both requested phases are implemented in this run, per the explicit request. Fable/Claude design review, actual browser accessibility and responsive checks remain open acceptance gates, not inferred passes.
- Store is still disabled in the seed. Launch decisions and credentials from the plan's Build defaults remain unconfigured. Inventory is the Phase 2 read stub; publishing/restoring content never mutates operational stock.
