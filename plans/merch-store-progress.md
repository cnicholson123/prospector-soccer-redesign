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

## CHANGELOG — Phase 1 scope revision: Published concept showcase — 2026-11-09

Shipped

- Supersedes the earlier disabled-store/draft-seed defaults above. Store settings are now published with `enabled: true` and `Merch (concept)` navigation. All ten products, three bundles, five categories and four shop FAQs are published, so a freshly seeded filesystem store has a populated showcase without an admin publication step. All 145 seed documents are now published.
- Shop hero eyebrow is `Proof of concept`. Landing, FAQ and pickup placeholder copy make the demonstration status explicit. The active pickup option is labeled illustrative with no scheduled pickup; its active flag preserves the existing publication validation and does not enable ordering.
- Seed tests assert published products/bundles/categories and enabled settings. HTTP tests verify the seeded landing/product/bundle/category pages work before any admin write, while retaining explicit disabled-store and unpublished-component coverage.

Verification / limits

- The final `npm test` run includes isolated filesystem seeding, complete published-seed validation and the HTTP showcase checks: **PASS**. No existing user content store was reseeded or overwritten.
- Real Neon/Postgres and Blob: **not run (no env)**. Existing initialized stores need an intentional content/seed update; changing repository seed files alone does not publish over existing edited content.

## CHANGELOG — Phase 2 scope revision: Live-but-unusable proof of concept — 2026-11-09

Shipped against the scope revision

- Added a persistent gold/navy banner immediately after the sticky site header on every shop route, including category, lookup, coming-soon and missing/status URLs. Added the exact inline note `Proof of concept only — no orders are accepted. Prices are illustrative.` near product and bundle prices/actions, collection cards and cart totals/actions. The cart page and drawer have a disabled `Checkout disabled — proof of concept` button. Size selection, add/remove and quantity changes remain available.
- Added `SHOP_CHECKOUT=disabled|enabled`; unset means disabled in every environment. Only explicit `NODE_ENV=development` or `test` permits `enabled`; production (and other environments) refuses it at config load. Disabled checkout renders an explanation without a form or token. Disabled order lookup also avoids collecting personal details.
- Added shared middleware as the first handler in both shop and admin applications. Public/admin checkout, order, payment and webhook route families return exactly HTTP 403 `{ "error": "checkout_disabled" }`, before storage construction, authentication, body parsing or provider work. The families include future routes so deferred handlers cannot bypass the deployment boundary. Tests exercise unset/disabled configurations, all methods, malformed/oversized bodies, encoded paths and an injected downstream handler that must never run.
- Added the permission-protected read-only deployment-status endpoint and a Store settings status panel: `Checkout: disabled by deployment (proof of concept)`. It is separate from editable content and has no toggle. Retained a client-side 403 fallback that preserves the cart and leaves any stale checkout submit button disabled.
- Ordinary public pages change only by the requested `Merch (concept)` desktop/mobile links. Cart chrome and store scripts remain on shop pages, overriding Phase 2's earlier global cart enhancement to meet this run's stricter public-page constraint. The eight golden files and original public stylesheet remain unchanged. The golden harness now requires exactly the two new link strings and removes only those strings before its full comparison; no other markup is ignored for this change. The rationale is also recorded in the plan's Scope revision section.
- Updated `shop-slice.spec.ts` for all three widths: browse → product → choose sizes → add to drawer → cart, persistence, quantity/removal, disabled checkout and explanation, persistent banners across shop pages, no checkout requests from the UI, direct endpoint refusal and no checkout form. Retained keyboard navigation and catalog generation coverage; added the read-only admin status assertion. Browser configuration pins checkout disabled. Orders/payments/providers/fulfillment (phases 3–9) remain deferred.
- Updated deployment/env documentation and the unbundled Node runtime smoke to verify public quotes, operational 403s and the disabled checkout page in every packaged function.

Final verification

- `npm run build` — **PASS**, Vite and both TypeScript configurations.
- `npm test` — **PASS: 679 passed, 17 skipped**, 29 test files passed / 2 hosted-service files skipped. Includes all eight unchanged public golden files and `npm run check:runtime`.
- `check:runtime` — **PASS** on Node v25.9.0: explicit `.js` imports, isolated FS seed, all three function packages, public and private-preview empty-cart quotes, disabled operational routes and checkout SSR.
- `npm run test:e2e -- --list` — **PASS: 32 tests in 9 files**. Playwright execution, responsive visual review, screenshots and Lighthouse — **not run (sandbox)**; Claude must run installed Chrome afterwards.
- `npm run check-facts` — **PASS: 122 facts**. `node --check public/assets/js/shop.js` — **PASS**. `git diff --check` — **PASS**.
- Real Neon/Postgres and Blob — **not run (no env)**. No payment credentials or hosted services were used. No dependencies, golden fixtures or base public CSS changed. No commit, merge, push, deployment, global configuration change or persistent edit outside this repository was performed.

Open acceptance gates

- Browser execution/design/accessibility remain unverified in this sandbox. No implementation requirement is deferred; visual/browser acceptance is not claimed from SSR or unit tests.

## CHANGELOG — Phase 2 pre-deployment fix-up: Chrome failures and hero contrast — 2026-11-09

Shipped against the concept browsing acceptance criteria

- Read the supplied Chrome run and the three failing error contexts. The 390px failure is an application accessibility defect: the Menu label is hidden below 420px, leaving its icon-only button unnamed. The existing menu enhancement now assigns the accessible name `Menu`; no timeout was increased. Public server-rendered HTML, the base stylesheet and golden files are unchanged.
- The 820px failure is a test assumption: the mobile navigation's CSS arrow contributes to the link's accessible name (`Merch (concept) →`). The spec now scopes to the correct Main/Mobile navigation, permits that decorative arrow, verifies the menu expanded, and follows the actual link to the store.
- The 1280px strict-mode failure is a test selector defect: both the page summary and the intentionally retained cart drawer use `.cart-summary` inside `main`. The spec now targets the single `aside.cart-summary` and asserts its uniqueness. Banner and inline explanation copy already match the final scope contract; their exact assertions remain intact.
- Fixed the real hero contrast defect in store-only CSS: the complete headline is white on navy, with the existing light-gold emphasis preserved. Added computed-color assertions and hero screenshots at all three widths to catch invisible text that a visibility assertion alone cannot detect. Cart editing, disabled checkout, persistent notices and keyboard coverage remain in the specs.

Verification / limits

- `npm run build` — PASS. Final `npm test` on FS — PASS: 699 passed, 25 hosted/Postgres skips; all eight unchanged public goldens and the plain-Node ESM `check:runtime` for admin/render/shop pass on Node v25.9.0.
- `npm run test:e2e -- --list` — PASS: 37 tests in 10 files. Browser execution, computed-color assertions, screenshots and actual responsive/keyboard verification — **not run (sandbox)**. Claude must rerun Chrome; no visual pass is claimed here.
- `npm run check-facts` — PASS: 122 facts. `node --check public/assets/js/main.js` and `git diff --check` — PASS.
- The two-line public JS accessibility enhancement is necessary to fix the real 390px defect while preserving public HTML/CSS/design. No other public-page appearance changes, dependencies or golden adjustments were introduced. No commit, push or deployment was performed.

## CHANGELOG — Phase 1 pre-deployment fix-up: Safe existing-store showcase seed — 2026-11-09

Shipped against the production data-path acceptance criteria

- Added `scripts/seed-store.ts` / `npm run seed:store` for initialized stores. The general seed is not safe for this deployment: it rejects edited content unless forced, and forcing it can replace live documents. The new command creates only missing IDs among the 10 products, 3 bundles, 5 categories, 2 store singletons, 4 shop FAQs and 10 static store media records. New settings retain `enabled=true`; `SHOP_CHECKOUT` stays disabled by default and in the documented deployment command.
- New records get sealed creation revisions and audits as actor `seed`, with the `seed:store` source. One normal Store publication writes only the newly created store envelopes, appends sealed publication revisions and an audit with the exact item list, and reuses existing manifest revision IDs. Existing non-store and store content, draft/live versions, trash, schedules, media, users, sessions, metadata and all previous history remain intact. No SQL, Store interface or driver changes were necessary.
- Repeated runs make no changes. Interrupted creations resume only the command's own untouched version-1 drafts; unrelated editor drafts are never published. Publication uses the existing FS journal/Postgres transaction recovery. Conflicting dependencies fail instead of being changed; a concurrent edit to a seed product causes CAS refusal, while a concurrent non-store draft edit survives publication.
- Replaced the deployment README's showcase section with **Store showcase deployment**, including the exact production environment/command sequence, expected 34-new/zero-repeat counts, existing-record limitations, verification URLs, cache behavior and local FS instructions. **No database migration is required**: content schema version 2 uses the existing migration-1 JSONB tables, not a new SQL schema or operational ledger.

Verification / limits

- Added the same eight seed contract cases on FS and Postgres, starting with the original 111 site records. Coverage includes published/pending edits, trash, schedules, unchanged historical revisions/audit/manifests, users/sessions/metadata, existing disabled settings, incompatible drafts, idempotence, interrupted creation/publication, and concurrent editors. HTTP checks verify the newly seeded showcase pages and no-form checkout.
- Final FS `npm test` — PASS: 699 tests, 25 explicit no-env skips. `npm run build` and `check:runtime` — PASS; no dependency or lockfile change.
- Final `DATABASE_URL=… POSTGRES_TEST_WS_PROXY=… npm test` against disposable Docker **PostgreSQL 17.11** through the existing Neon WebSocket test proxy — PASS: **740 tests, 1 private-Blob no-env skip**, including all eight seed contract cases on both FS and Postgres, the shared Store/SQL contracts, goldens and all three runtime packages. The test fixtures use isolated schemas; the two task-specific containers were stopped and removed after verification.
- Real Neon, private Blob and production seeding — **not run (no env)**. Docker verification is local PostgreSQL, not a claim of hosted-service verification. No payment credentials, user messages, global configuration edits, commits, pushes or deployments were used.
