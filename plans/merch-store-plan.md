# Prospector Soccer Club — Merch store implementation plan

Status: v1 for review · Author: lead architect (Fable) · Implementer: gpt-6.1-sol via Codex CLI, one phase per run · Reviewer: Fable (every phase) · Branch: `merch-store` (from `admin-cms` @ bb42b95)

This plan builds on `plans/admin-plan.md` (§0–7 architecture, §13 conventions, §17–19 decisions, §18 amendments) and `plans/admin-progress.md`. Where this plan is silent, the admin plan governs. Where they conflict, this plan governs for files under `server/shop/`, `server/render/shop/`, `admin/src/shop/`, `api/shop.ts`, `public/assets/{css,js}/shop.*` only; nothing here changes the behaviour of existing public pages or admin screens unless a phase says so explicitly.

## 0. Summary of decisions

| Topic | Decision |
|---|---|
| Two kinds of data | **Catalog is content**: products, variants, bundles, categories, the shop page and store settings are ordinary schema collections with draft / preview / publish / revisions / audit / restore. **Operations are a ledger**: inventory counters, orders, customers, payments, waitlist, discount usage and notifications live in a separate `ShopStore` that is never part of the published snapshot, never CDN-cached and never touched by publish or site restore. Rationale in §4. |
| Feature flag | `storeSettings.enabled` (published content). Turning the store on is a publish: previewable with `?preview=1`, audited, reversible. Default `false` in the seed, so production stays off until Chris publishes it. The header nav gains a "Shop" link only when enabled. |
| Functions | A **third Vercel function `api/shop.ts`** (Hono) serves the public store API: quote, availability, checkout, order lookup, payment webhooks. Admin store routes live in the existing `api/admin.ts` under `/api/admin/shop/*`. Public store pages (`/shop/*`) render in `api/render.ts`. Total 3 functions (cap 12). |
| Rendering | Store pages are **server-rendered** from the snapshot (catalog) plus a live read of inventory counters, cached `s-maxage=15, stale-while-revalidate=60`, CDN tags `content` + `shop`; stock changes purge `shop` best-effort. Cart, checkout, confirmation and lookup pages are `no-store`. |
| Cart | **Client-side cart** (`localStorage`), always **server-priced** through `POST /api/shop/quote`. No cart table, no cart cookie, no server state until checkout. Product pages, bundle pages, landing, order status and lookup work without JS; add-to-cart and checkout need JS (accepted by the brief; a `<noscript>` note explains). |
| Money | Catalog prices use the existing `money` field (dollars) with a new `exact: true` option (single amount, two decimals max). **All arithmetic is in integer cents** in `server/shop/pricing.ts`; conversion happens at exactly one chokepoint. Orders snapshot every price in cents. Clients never send prices. |
| Payments | `PaymentProvider` adapter. **`offline`** (default, zero credentials): order is placed as `pending_payment`, customer pays the treasurer at pickup or by Zelle/Venmo/check per the settings text, a volunteer records the payment. **`stripe`**: Stripe Checkout hosted page via Stripe's REST API with `fetch` (no SDK, keeps the dependency allowlist intact), webhook signature verification, idempotent event handling, server-side settle on return, refunds via API. Switched by `PAYMENT_PROVIDER` env; both providers can be enabled at once (customer picks "Pay now by card" or "Pay at pickup") when Stripe keys exist. |
| No overselling | Stock is reserved atomically at order creation inside the store's existing exclusive section (Postgres advisory-lock transaction / FS lock). Reservations expire (default 30 min for card payments, 14 days for unpaid offline orders) and are released by cron or lazily. Pre-order products have no stock cap unless a per-variant limit is set. |
| Sales models | Per product `salesMode`: `preorder` (window with open/close dates, demand aggregated for the supplier run — the default), `stock` (inventory counters, sold-out state), `waitlist` (no purchase, collect email + size). |
| Orders | Human-friendly sequential numbers `PSC-1001…`; per-order random access token for the confirmation URL; lookup requires email + number with rate limits and a generic failure. Statuses: `pending_payment → paid → in_production → ready_for_pickup → picked_up | shipped`, plus `cancelled` and `refunded`; every transition is an immutable order event and an audit entry (order number only, no PII in audit/logs). |
| Fulfillment | Pickup at club locations/events (default, configured in settings) and optional flat-rate shipping. Phone-first **Pickup mode** screen for volunteers. |
| Emails | `Notifier` adapter: `log` by default (records to the notifications ledger, sends nothing), `resend` later via `fetch` + `RESEND_API_KEY`. Confirmation, payment received, ready for pickup, shipped. Never blocks an order. |
| Tax | `storeSettings.tax.mode`: `off` (default) / `flat` (percent, label, taxShipping) / `stripe_tax` (automatic tax on the Checkout session). The legal question is flagged in §19, not guessed. |
| Permissions | New actions `orders.view`, `orders.fulfill` (Editor+), `orders.manage`, `store.manage` (Admin+) in the existing `can()` table. Catalog editing uses the existing `content.*` permissions. Customer PII is returned only to `orders.view` holders. |
| Dependencies | **None added.** Stripe and Resend are plain HTTPS APIs; HMAC verification uses `node:crypto`. |
| Seed | The 10 concept products with realistic variants, 5 categories and 3 bundles are seeded as **drafts** ("concept"). `storeSettings` (enabled: false) and `shopPage` are seeded published so the layout can read them without changing today's HTML. Product images are registered as static `media` records. |

---

## 1. Architecture

```
 Visitor ─GET /shop, /shop/p/:slug, /shop/b/:slug, /shop/c/:slug ─▶ CDN (s-maxage 15, swr 60, tags content+shop) ─miss─▶ api/render.ts
         ─GET /shop/cart, /shop/checkout, /shop/orders, /shop/order/:n?t= ─▶ api/render.ts (no-store)                server/render/shop/*
                                                                                                                      │ snapshot (catalog)
 shop.js (cart in localStorage) ─POST /api/shop/quote, /checkout, /orders/lookup ─▶ api/shop.ts (Hono)               │ + ShopStore.getStock
         ─GET /api/shop/availability                                               server/shop/http/*                 ▼
                                                                                      │ pricing · reservation · providers   Store (content)
 Stripe ─POST /api/shop/webhooks/stripe (signed) ────────────────────────────────▶    │                                     ShopStore (ledger)
                                                                                      ▼                                    ┌──────┴──────┐
 Admin SPA ─/api/admin/shop/* (cookie + CSRF + can()) ─▶ api/admin.ts ─▶ server/shop/admin-routes.ts ─▶ ShopStore    KvShopStore   PostgresShopStore
                                                                                                                      (FS dev/test)  (Neon prod)
```

Request flow, product page: CDN → `api/render.ts` → `store.getSnapshot()` (cached in instance) → `shopStore.getStock(variantIds)` (one read) → `server/render/shop/product.ts` → HTML. The page embeds `data-variant` attributes with ids and labels only; prices shown are from the snapshot, never trusted back.

Request flow, checkout: `shop.js` posts `{ token, lines, customer, fulfillment, discountCode?, website: '' }` → `api/shop.ts` → Origin + content-type + token + honeypot + rate limit → load snapshot → `price(lines)` → `shopStore.createOrder({ order, events, reservation })` (atomic: number allocation, stock check, reservation, order write) → `provider.begin(order)` → response `{ orderNumber, next }` → client follows `next.url` (Stripe Checkout, or our confirmation page for offline).

Request flow, admin transition: SPA → `POST /api/admin/shop/orders/:id/transition { to, expectedVersion, note }` → `requirePermission('orders.fulfill' | 'orders.manage')` → `transitions.ts` validates `from → to` → `shopStore.updateOrder({ patch, event, stock?, audit })` (CAS on `version`) → notifier (non-blocking) → purge `shop` tag if stock changed.

## 2. URL map and caching

| URL | Handler | Cache | Notes |
|---|---|---|---|
| `/shop` | render | 15 / swr 60, tags `content`,`shop` | landing |
| `/shop/p/:slug` | render | same | product detail; 404 when unpublished or store disabled |
| `/shop/b/:slug` | render | same | bundle detail |
| `/shop/c/:slug` | render | same | category listing |
| `/shop/cart` | render | `no-store` | SSR shell; lines rendered by `shop.js` from localStorage via `/quote` |
| `/shop/checkout` | render | `no-store` | SSR form shell + signed checkout token (§11) |
| `/shop/orders` | render | `no-store` | lookup form (works without JS: form POST) |
| `/shop/order/:number?t=<token>` | render | `no-store`, `noindex` | confirmation / status page; 404 without valid token |
| `POST /api/shop/quote` | shop fn | – | price a cart, report availability problems |
| `GET /api/shop/availability?ids=` | shop fn | `no-store` | JS refresh of stock badges on cached pages |
| `POST /api/shop/checkout` | shop fn | – | create order (§7) |
| `POST /api/shop/orders/lookup` | shop fn | – | accepts JSON or form-encoded; 303 to the status URL or back with `?error=1` |
| `POST /api/shop/waitlist` | shop fn | – | join waitlist (Phase 6) |
| `POST /api/shop/webhooks/stripe` | shop fn | – | signed; always reachable even when the store is disabled |
| `/api/admin/shop/*` | admin fn | `no-store` | §8.1 |

`vercel.json` additions (additive): rewrites `{"source":"/shop","destination":"/api/render?page=shop"}`, `{"source":"/shop/:path*","destination":"/api/render?page=shop&path=:path*"}` **before** the generic `/:page` rule; `{"source":"/api/shop/:path*","destination":"/api/shop"}`; `functions["api/shop.ts"]` with the same `includeFiles` pattern as the others if it reads any asset (it should not). The cron path stays `/api/admin/cron/settle`; its handler additionally calls `shop.expireReservations` and `shop.sendPendingNotifications` (§9).

Store disabled: `/shop*` renders the 404 page (or a "Coming soon" page when `storeSettings.comingSoon.enabled`), `/api/shop/*` returns 404 except the webhook route, the nav link is absent, `sitemap.xml` omits store URLs. `?preview=1` (session required) renders the store from drafts regardless of the flag so the club can review it before launch.

Cache purge: `server/render/cdn.ts` gains `tagShop()` and `purgeShop()` mirroring the content helpers. Publish already purges `content` (which store pages also carry). Stock moves and order transitions that change availability call `purgeShop()` best-effort.

## 3. Catalog schema

Additive changes to `shared/schema.ts` (bump `SCHEMA_VERSION` to 2; existing seeds and goldens must still pass):

- `money` field gains `exact?: boolean`: when set, `max` is forbidden, `amount` must be `≥ 0` with at most two decimals. Existing `money` fields are unchanged.
- `text` field gains `pattern?: 'slug'` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 60 chars). Publish-mode validation requires slugs to be unique within the collection.
- `media.variants` gains optional `small` (480 px URL). `Snapshot.media[*]` gains optional `small`. `buildSnapshot` copies it when present. Existing records have none; nothing renders differently.
- `faqs.page` select gains `shop`.
- New collection names: `products`, `bundles`, `categories`, `storeSettings` (singleton), `shopPage` (singleton). New `PageName` member `shop` for preview targeting; the handler dispatches `/shop*` before the generic page table so the existing `templates` map and sitemap logic are untouched except for the conditional store URLs.

### 3.1 Collections

`categories` (collection, orderable, titleField `name`, preview page `shop`)

| Field | Type | Notes |
|---|---|---|
| `name*` | text | "Apparel" |
| `slug*` | text pattern slug | `/shop/c/apparel` |
| `description` | text multiline | |
| `image` | image | optional tile image |

`products` (collection, orderable, titleField `name`, preview page `shop`, anchor → `/shop/p/<slug>`)

| Field | Type | Notes |
|---|---|---|
| `name*` | text | |
| `slug*` | text pattern slug | |
| `categoryId*` | reference → categories | |
| `tagline` | text | lookbook "The flagship" |
| `description*` | richtext | |
| `details` | list `{ label, value }` itemLabel `label` | Material, Decoration, Sizes, Colors |
| `images` | list `{ image*, caption }` minItems 1 | first image is primary; cards use `small` |
| `price*` | money exact | adult / base price |
| `youthPrice` | money exact | used by variants with `group: youth` when no override |
| `variants*` | list `{ label*, group* (select youth/adult/one-size), sku, color, priceOverride (money exact), active (bool, default true), limit (number int ≥ 0; pre-order cap per variant, blank = none) }` itemLabel `label`, minItems 1 | variant id = `<productId>.<_key>`; `_key` is the stable identity used by stock and orders |
| `salesMode*` | select `preorder` / `stock` / `waitlist` | default `preorder` |
| `preorder` | object `{ opensAt (datetime), closesAt (datetime), expectedDelivery (text), note (text) }` | window is open when `opensAt ≤ now < closesAt` (either bound may be blank = unbounded) |
| `allowWaitlist` | boolean | when `stock` is sold out, show "Join the waitlist" |
| `shippable` | boolean default true | false = pickup only (blanket, backpack may still ship; club decides) |
| `sizeGuide` | richtext | rendered in a `<details>`; falls back to `storeSettings.policies.sizeGuideGeneral` |
| `badge` | text | "New", "Limited" |
| `featured` | boolean | shows in landing featured grid when `shopPage.featuredSection.productIds` is empty |
| `relatedProductIds` | reference many → products | |
| `supplier` | object `{ estimatedCost, moq, leadTime, notes (multiline) }` group "Internal — never shown on the site" | rendered nowhere; a render test asserts it |

`bundles` (collection, orderable, titleField `name`, preview page `shop`)

| Field | Type | Notes |
|---|---|---|
| `name*`, `slug*`, `tagline`, `description*` (richtext), `image*` | | |
| `price*` | money exact | fixed bundle price |
| `components*` | list `{ productId* (reference → products), quantity (int ≥ 1, default 1), fixedVariantKey (text; optional: lock to one variant, e.g. the decal set) }` minItems 2 | customer picks a variant for each component without `fixedVariantKey` |
| `featured` | boolean | gold styling on the landing bundles band |
| `shippable` | boolean default true | |

Savings are derived at render time: `Σ component base price × qty − bundle price` (youth selections do not change the bundle price; §19 Q8).

`storeSettings` (singleton, permission ceiling like `site`: Editor+ to edit)

| Group | Fields |
|---|---|
| General | `enabled` (bool, default false), `comingSoon { enabled (bool), title, text }`, `announcement` (text; shown as a gold note on store pages), `contactEmail` (email), `nav { label (default "Shop"), showInHeader (bool, default true) }` |
| Payment | `offline { enabled (bool, default true), label (default "Pay at pickup"), instructions (richtext: who to pay, Zelle/Venmo/check details, deadline) }`, `card { enabled (bool, default false) }` (effective only when `PAYMENT_PROVIDER` includes stripe; the admin shows the provider status) |
| Fulfillment | `pickup { enabled (bool, default true), options[] { label*, details, active (bool) } }` (e.g. "Saturday practices at Cameron Park", "AGM, December"), `shipping { enabled (bool, default false), flatRate (money exact), freeOver (money exact), note }` |
| Tax | `tax { mode (select off/flat/stripe_tax, default off), flatRatePercent (number 0–15, 3 decimals), label (default "Sales tax"), taxShipping (bool) }` |
| Orders | `orders { numberPrefix (text, default "PSC"), maxQuantityPerLine (int, default 10), reservationMinutes (int, default 30), offlineHoldDays (int, default 14; 0 = never auto-cancel), customerNoteEnabled (bool, default true), collectPlayerTeam (bool, default true) }` |
| Notifications | `notifications { fromName (default "Prospector Soccer Club"), replyTo (email), confirmationNote (richtext), pickupNote (richtext) }` |
| Policies | `policies { returns (richtext), sizeGuideGeneral (richtext), preorderExplainer (richtext) }` |

`shopPage` (singleton, preview page `shop`)

`meta`, `hero { eyebrow, title (richtext inline), lead, image, primaryCta (link), secondaryCta (link) }`, `featuredSection { eyebrow, title, lead, productIds (reference many → products) }`, `bundlesSection { eyebrow, title, lead }`, `categoriesSection { eyebrow, title }`, `how { eyebrow, title, steps[] { title, text } }` (how pre-orders work), `faqSection { eyebrow, title }` (uses `faqs` where `page = shop`), `cta { eyebrow, title, text, buttons }`.

### 3.2 Publish-mode validation (`server/shop/catalog.ts`, invoked from the existing `validate(..., { mode: 'publish' })` for these collections)

- Slugs unique per collection; no slug equals a reserved word (`cart`, `checkout`, `orders`, `order`, `p`, `b`, `c`).
- Variant `_key`s present and unique within a product; at least one active variant; `label` unique within a product.
- Bundle components reference published, non-trashed products; `fixedVariantKey` exists on that product; `quantity ≥ 1`.
- `preorder.closesAt > opensAt` when both set.
- `storeSettings.enabled = true` requires `offline.enabled || card.enabled`, at least one active pickup option or shipping enabled, and `contactEmail`.
- Draft mode stays lenient (the admin autosaves partial products).

### 3.3 Seed (`content/seed/{categories,products,bundles,storeSettings,shopPage}.json`, `media.json` additions)

Categories: Apparel, Headwear, Accessories, Gear, Collectibles. Products (all `salesMode: preorder`, `status: draft`, images → `/assets/img/shop/<id>.webp` with `small` → `<id>-sm.webp`, details and descriptions from `plans/merch/lookbook-src/build_book.py`, supplier estimates in `supplier`):

| Product | Price | Youth | Variants |
|---|---|---|---|
| Crest Hoodie | $50 | $45 | Youth XS, S, M, L, XL · Adult S, M, L, XL, 2XL, 3XL |
| Gold Country Fan Tee | $24 | $20 | Royal: Youth XS–XL, Adult XS–3XL (color `Royal blue`) |
| Supporter Scarf | $25 | – | One size |
| Crest Trucker Cap | $25 | – | Adult one size, Youth one size |
| Pom Beanie | $22 | – | Adult, Youth |
| Engraved Insulated Bottle | $30 | $24 | 32 oz (adult), 20 oz (youth, override $24) |
| Enamel Pin Set | $15 | – | Set of 4 |
| Sherpa Sideline Blanket | $40 | – | One size |
| Cleat Backpack | $45 | – | Youth, Adult |
| Car Decal + PSC Magnet | $10 | – | Set |

Bundles (drafts): New Family Pack $40 = Fan tee + Decal/magnet set (fixed) + Pin set (fixed), saves $9; Sideline Pack $79 (featured) = Beanie + Scarf (fixed) + Blanket (fixed), saves $8; Coach Kit $95 = Hoodie + Cap + Bottle, saves $10. Seed `faqs` gains four `shop` entries (pre-orders, pickup, payment, exchanges) as drafts. `storeSettings` seeded **published** with `enabled: false`, offline payment on, one pickup option ("Saturday practices — Cameron Park", inactive placeholder details), tax off. `shopPage` seeded published with copy adapted from the lookbook ("Wear the gold.").

`npm run seed` stays idempotent; the existing eight goldens must be byte-identical afterwards (store disabled ⇒ layout emits nothing new).

## 4. Inventory and sales models

Why counters are not content: a published snapshot is restorable to any earlier site version. If on-hand counts lived in it, restoring the home page copy would also restore last month's stock and oversell. Stock must also change on every order without an editor publishing. So:

- **Definition** (what a variant is, its SKU, price, whether it is active, pre-order limits) is content on the product.
- **Counters** (`onHand`, `reserved`, `sold`) are a ledger keyed by variant id `<productId>.<_key>` in `ShopStore`, changed only by orders and by explicit, audited adjustments with a reason. The product editor shows the live counters beside each variant row (read from `/api/admin/shop/stock`) with an "Adjust" action; the Inventory screen lists everything.

Availability algorithm (`server/shop/availability.ts`, pure):

| salesMode | Available when | Quantity cap |
|---|---|---|
| `preorder` | window open (`opensAt ≤ now < closesAt`) and variant active | `variant.limit − (reserved + sold)` when `limit` set, else `maxQuantityPerLine` |
| `stock` | variant active and `onHand − reserved − sold > 0` | `onHand − reserved − sold` |
| `waitlist` | never purchasable; shows "Join the waitlist" | – |

Display states: `Pre-order · closes Dec 1`, `Pre-order opens Nov 20`, `In stock`, `Only 3 left` (≤ 5), `Sold out`, `Sold out · join the waitlist`, `Pre-orders closed`. Bundles are available when every component has an available variant; the bundle picker only offers available variants.

Stock operations (all inside one exclusive section / transaction, all-or-nothing):

- `reserve(orderId, lines, expiresAt)`: for each `stock`-mode line check `available ≥ qty`, for each limited pre-order line check the cap, then `reserved += qty` and append `stock_moves(kind: reserve)`. Returns `{ ok }` or `{ shortages: [{ variantId, available }] }` without writing.
- `commit(orderId)`: `reserved −= qty; sold += qty` (`kind: commit`) when payment is recorded.
- `release(orderId)`: `reserved −= qty` (`kind: release`) on cancel or expiry.
- `restock(orderId, lines?)`: `sold −= qty; onHand` unchanged for stock mode (the item physically returned); for pre-order lines just `sold −= qty` (`kind: restock`) — used on refund when the admin ticks "Return to stock".
- `adjust(variantId, { setOnHand | delta }, reason, actor)`: `kind: adjust`; `onHand` may never go below `reserved + sold` for stock mode (422 otherwise).

## 5. Pricing engine (`server/shop/pricing.ts`, pure, exhaustively unit-tested)

```ts
interface CartLine = { kind: 'product'; productId; variantKey; quantity } | { kind: 'bundle'; bundleId; selections: Record<componentIndex, variantKey>; quantity };
interface PricedLine { ...CartLine; title; variantLabel; sku?; unitCents; lineCents; salesMode; shippable; components?: {...}[]; problems: Problem[] }
interface Totals { subtotalCents; discountCents; shippingCents; taxCents; totalCents; taxMode; taxRateBps?; currency: 'usd' }
price(snapshot, stock, settings, cart, { now, discount?, fulfillment? }): { lines: PricedLine[]; totals: Totals; problems: Problem[] }
```

Rules: `unitCents = round(priceOverride ?? (group === 'youth' && youthPrice ? youthPrice : price) × 100)`; bundle `unitCents = round(bundle.price × 100)`; `subtotal = Σ lineCents`; `discount = min(subtotal, percent ? round_half_up(subtotal × pct) : fixed)`; `shipping = method === 'shipping' ? (freeOver && subtotal − discount ≥ freeOver ? 0 : flatRate) : 0`; `tax = mode === 'flat' ? round_half_up((subtotal − discount + (taxShipping ? shipping : 0)) × rate) : 0` (`stripe_tax` leaves `tax = 0` until Stripe reports it); `total = subtotal − discount + shipping + tax`. Quantity is clamped to `[1, cap]` with a `qty_capped` problem; unknown or unpublished items produce `unavailable`; a `shipping` fulfillment with a non-shippable line produces `pickup_only`. Lines are deduplicated by identity (same variant / same bundle selections) by summing quantities. Totals never go negative; everything is an integer.

## 6. Orders

### 6.1 Records

```ts
interface Order {
  id: string;                      // ord_<time-sortable>_<rand>
  number: string;                  // "PSC-1001"
  version: number;                 // CAS for admin updates
  status: 'pending_payment' | 'paid' | 'in_production' | 'ready_for_pickup' | 'picked_up' | 'shipped' | 'cancelled' | 'refunded';
  createdAt; updatedAt;
  accessTokenHash: string;         // sha256 of the 32-byte token in the confirmation URL
  customer: { name; email; emailKey /* lower-cased */; phone?; playerName?; team? };
  fulfillment: { method: 'pickup' | 'shipping'; pickupOptionKey?; pickupLabel?; address?: { name; line1; line2?; city; state; postalCode } ; trackingNote? };
  lines: OrderLine[];              // priced lines from §5, frozen
  totals: Totals;
  discount?: { code; type; value; discountId };
  payment: { provider: 'offline' | 'stripe'; status: 'unpaid' | 'paid' | 'refunded' | 'partially_refunded'; method?: 'card' | 'cash' | 'check' | 'zelle' | 'venmo' | 'other'; reference?; paidAt?; recordedBy?;
             stripe?: { sessionId; paymentIntentId?; chargeId?; receiptUrl? }; refunds: { id; amountCents; at; by; reason; providerRefundId?; restocked: boolean }[] };
  reservation?: { expiresAt: string };   // present while stock is reserved
  customerNote?: string;
  notes: { id; at; by; byName; text }[]; // internal, orders.fulfill+
  catalogVersion: number;          // snapshot.siteVersion at purchase
  redactedAt?: string;
}
interface OrderEvent { id; orderId; at; actorId; actorName; type: 'created' | 'payment_begun' | 'payment_recorded' | 'status_changed' | 'note_added' | 'refunded' | 'notified' | 'reservation_released' | 'redacted'; from?; to?; meta? }
```

Order events are append-only (Postgres `retain_history`-style trigger; KV never overwrites). Every admin action also writes a normal `AuditEntry` with `collection: undefined`, `action: 'shop.order.<verb>'`, `targetTitle: order.number`, `meta: { orderId, from, to }` — **never** customer fields.

### 6.2 Transitions (`server/shop/transitions.ts`, table-driven)

| From | To | Who | Side effects |
|---|---|---|---|
| `pending_payment` | `paid` | provider webhook / settle, or `orders.manage` "Record payment" | `payment.status = paid`, `stock.commit`, reservation cleared, notify `payment_received` (offline) or `order_confirmed` (card) |
| `pending_payment` | `cancelled` | customer abandon (Stripe `checkout.session.expired`), expiry job, `orders.fulfill` | `stock.release`, notify none |
| `paid` | `in_production` | `orders.fulfill` (bulk from the production report) | — |
| `paid`, `in_production` | `ready_for_pickup` | `orders.fulfill` (single or bulk) | notify `ready_for_pickup` |
| `paid`, `in_production`, `ready_for_pickup` | `shipped` | `orders.fulfill` with optional tracking note | notify `shipped` |
| `ready_for_pickup` | `picked_up` | `orders.fulfill` (Pickup mode) | — |
| any paid state | `refunded` | `orders.manage` via Refund (full) | provider refund or recorded offline refund; optional restock |
| `paid`…`picked_up` | (partial refund, status unchanged) | `orders.manage` | `payment.status = partially_refunded` |
| `paid`, `in_production` | `cancelled` | `orders.manage` | only after a full refund exists or with explicit "Refunded outside the system" note; `stock.release/restock` |

Anything else is 409 `invalid_transition`. Transitions carry `expectedVersion`; stale → 409 with the current order.

### 6.3 `ShopStore` interface (`server/shop/store/types.ts`)

```ts
export interface ShopStore {
  createOrder(input: { order: Order; events: OrderEvent[]; reserve: StockLine[]; audit?: AuditEntry }): Promise<Order | { shortages: Shortage[] }>; // allocates number, checks + reserves stock, writes order last
  getOrder(id): Promise<Order | null>; getOrderByNumber(number): Promise<Order | null>;
  listOrders(q: { status?: Order['status'][]; paymentStatus?; method?; q?: string /* number, name, email, player */; from?; to?; limit; cursor? }): Promise<{ items: Order[]; cursor? }>;
  updateOrder(m: { id; expectedVersion; patch: Partial<Order>; event: OrderEvent; stock?: StockOp[]; audit?: AuditEntry }): Promise<Order | 'conflict'>;
  listOrderEvents(orderId): Promise<OrderEvent[]>;
  getStock(variantIds: string[]): Promise<Record<string, StockRow>>; listStock(): Promise<StockRow[]>;
  adjustStock(op: { variantId; productId; setOnHand?: number; delta?: number; reason; actor; audit: AuditEntry }): Promise<StockRow>;
  listStockMoves(q: { variantId?; orderId?; limit; cursor? }): Promise<...>;
  claimPaymentEvent(e: { provider; eventId; type; at; orderId? }): Promise<'claimed' | 'duplicate'>; // claim-before-process idempotency
  expireReservations(now, rules: { cardMinutes; offlineHoldDays }): Promise<{ cancelled: string[] }>;
  addWaitlist(entry): Promise<void>; listWaitlist(q): Promise<...>; removeWaitlist(id, audit): Promise<void>;
  claimDiscountUse(codeKey, orderId, maxUses): Promise<'claimed' | 'exhausted'>; releaseDiscountUse(codeKey, orderId): Promise<void>;
  recordNotification(n: Notification): Promise<void>; listNotifications(orderId): Promise<Notification[]>; pendingNotifications(limit): Promise<Notification[]>; markNotification(id, patch): Promise<void>;
  productionReport(q: { productIds?; from?; to?; statuses }): Promise<ReportRow[]>;   // product × variant × status → qty
  salesSummary(q: { from; to }): Promise<{ orders; revenueCents; refundedCents; byDay; byProduct }>;
  redactOrder(id, actor, audit): Promise<Order>;  // replaces customer fields with "[redacted]", keeps totals/lines
}
```

`createShopStore(config, store)` in `server/shop/store/index.ts` picks `KvShopStore(FsPrimitives, exclusive)` for `fs` and `PostgresShopStore(pool)` for `postgres`, **sharing the same lock/transaction primitives** as the content store (`FsPrimitives.exclusive`; `pg_advisory_xact_lock(734215906)` + `BEGIN`), so a checkout and a stock adjustment can never interleave. Both pass `tests/shop/store-contract.test.ts` (FS always; Postgres when `DATABASE_URL`).

### 6.4 Storage layout

Postgres, `server/store/postgres-schema-shop.sql`, applied by the existing `migrate()` after `postgres-schema.sql`, same style (JSONB body + generated columns, `IF NOT EXISTS`, `INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING`):

```sql
shop_orders(id pk, body jsonb, number text GENERATED … UNIQUE, status, payment_status, email_key, created_at, version, fulfillment_method)   -- idx (status, created_at desc), (email_key), (created_at desc)
shop_order_events(id pk, body, order_id, at)                                   -- retain trigger (no update/delete)
shop_stock(id pk /* variantId */, body)
shop_stock_moves(id pk, body, variant_id, order_id, at)                         -- retain trigger
shop_payment_events(id pk /* provider:eventId */, body)                         -- INSERT … ON CONFLICT DO NOTHING is the claim
shop_waitlist(id pk, body, product_id, email_key)
shop_discount_uses(id pk /* codeKey:orderId */, body, code_key)
shop_notifications(id pk, body, order_id, status, at)
shop_counters(id pk, value bigint)                                              -- 'order-number'
```

FS (`KvShopStore` over `KvPrimitives`, journaled like `KvStore`; the order document is the commit point and is written last):

```
shop/orders/<id>.json                 shop/order-numbers/<number>.json → { id }       shop/order-events/<orderId>/<eventId>.json
shop/stock/<variantId>.json           shop/stock-moves/<yyyy-mm>/<id>.json            shop/payment-events/<provider>/<eventId>.json
shop/waitlist/<id>.json               shop/discount-uses/<codeKey>/<orderId>.json     shop/notifications/<orderId>/<id>.json
shop/counters/order-number.json       meta/pending-shop-mutation.json (journal)
```

Retention and privacy: orders are financial records — keep them (recommend 7 years; §19 Q6). Customer fields can be redacted per order (`orders.manage`, audited) and the cron redacts orders older than `SHOP_REDACT_AFTER_DAYS` (default off). Exports are audited (`shop.orders.export` with row count and filters). IP addresses are used only for rate-limit keys (hashed with `SESSION_SECRET`) and never stored on orders.

## 7. Checkout and payment providers

### 7.1 Checkout request (`POST /api/shop/checkout`)

1. Guards (§11): Origin, `Content-Type: application/json`, JSON ≤ 64 KB, checkout token valid and ≥ 3 s old, honeypot `website` empty, IP rate limit, store enabled.
2. Validate input shape with explicit max lengths (name ≤ 100, email RFC-ish ≤ 254, phone ≤ 30, player/team ≤ 80, note ≤ 500, address fields ≤ 120, state 2 letters, postal code pattern); ≤ 20 lines; quantities integers.
3. Price with §5 against the current snapshot; if any `problems`, respond 409 `cart_changed` with the full quote so the client can show "Sorry, Youth M just sold out" and re-render.
4. Choose provider: `payment.provider` from the request (`offline` | `stripe`), allowed only if configured and enabled in settings.
5. `shopStore.createOrder(...)`: allocate number, reserve, write. Shortage → 409 `cart_changed` with the quote recomputed.
6. `provider.begin(order)` → `{ kind: 'redirect', url }` (Stripe) or `{ kind: 'confirmation' }` (offline). If `begin` throws, the order is cancelled with `stock.release` and the client gets 502 `payment_unavailable` with "Card payments are unavailable right now; choose Pay at pickup or try again". Nothing is ever left reserved without a cancel path (expiry covers crashes).
7. Notifier: offline orders get `order_received` now; card orders get `order_confirmed` on `paid`.
8. Response 201 `{ orderNumber, next: { kind, url } }`; the client clears the cart only after receiving 201.

### 7.2 `PaymentProvider` (`server/shop/payments/types.ts`)

```ts
interface PaymentProvider {
  readonly id: 'offline' | 'stripe'; readonly label: string;
  begin(order: Order, ctx: { baseUrl; token }): Promise<{ kind: 'redirect'; url: string; patch: Partial<Order['payment']> } | { kind: 'confirmation' }>;
  settle?(order: Order): Promise<'paid' | 'pending' | 'expired'>;  // server-side verification when the customer returns
  refund?(order: Order, amountCents: number, idempotencyKey: string): Promise<{ providerRefundId: string }>;
  webhook?(request: Request): Promise<{ eventId; type; at; orderId?; outcome: 'paid' | 'expired' | 'ignored'; payload }>;
}
```

`offline` (`server/shop/payments/offline.ts`): `begin` → confirmation; no `settle`; `refund` records only.

`stripe` (`server/shop/payments/stripe.ts`), REST via `fetch` to `${STRIPE_API_BASE}/v1/...` with `Authorization: Bearer`, `Stripe-Version: <pinned, e.g. 2025-09-30.clover>` (Codex: pin the latest stable at implementation time and record it), form-encoded bodies, `Idempotency-Key` on every POST:

- `begin`: `POST /v1/checkout/sessions` with `mode=payment`, `client_reference_id=order.id`, `metadata[orderId]`, `metadata[orderNumber]`, `customer_email`, `line_items[]` from the frozen order lines (`price_data[unit_amount]=unitCents`, product name + variant label, quantity), shipping as `shipping_options[0][shipping_rate_data]` fixed amount when present, flat-mode tax as a separate non-taxable line item labelled per settings, `automatic_tax[enabled]=true` when `mode = stripe_tax`, discount as an ad-hoc coupon (`POST /v1/coupons` `amount_off`, `duration=once`, idempotent on order id) when `discountCents > 0`, `expires_at = now + reservationMinutes` (Stripe minimum 30 min), `success_url = ${base}/shop/order/${number}?t=${token}&from=stripe`, `cancel_url = ${base}/shop/checkout?resume=${number}`. Patch `payment.stripe.sessionId`. Idempotency key `checkout_${order.id}`.
- `webhook`: verify `Stripe-Signature` (`t=` and `v1=` parts; HMAC-SHA256 of `${t}.${rawBody}` with `STRIPE_WEBHOOK_SECRET`, `timingSafeEqual`, tolerance 300 s). Handle `checkout.session.completed` and `checkout.session.async_payment_succeeded` → `paid` (capture `payment_intent`, `amount_total`, `total_details.amount_tax` for `stripe_tax` mode); `checkout.session.expired` and `checkout.session.async_payment_failed` → `expired`; everything else `ignored`. Processing: `claimPaymentEvent` first (duplicate → 200 immediately), then look up the order by `metadata.orderId`, then transition inside the exclusive section; the amount paid must equal `order.totals.totalCents` (or, for `stripe_tax`, subtotal−discount+shipping must match and the tax is recorded from Stripe) else mark `payment.status = paid` but flag the order (`flags: ['amount_mismatch']`) for admin review — never silently accept.
- `settle` (called by the status page when `from=stripe` or the order is `pending_payment` with a session): `GET /v1/checkout/sessions/:id` → `payment_status = paid` ⇒ same transition as the webhook (idempotent through `claimPaymentEvent('stripe', 'settle:' + sessionId)`); `status = expired` ⇒ cancel. This keeps dev and webhook-outage cases correct.
- `refund`: `POST /v1/refunds` with `payment_intent`, `amount`, `Idempotency-Key: refund_${order.id}_${n}`.

The admin shows provider status (`GET /api/admin/shop/payments/status`): provider id, whether keys and webhook secret are present (never the values), live/test mode inferred from the key prefix, last webhook received at.

### 7.3 Confirmation / status page (`/shop/order/:number?t=`)

Server-rendered, `no-store`, `noindex`. Token compared with `timingSafeEqual` against `accessTokenHash`; mismatch → the same 404 page as an unknown number. Shows: order number (large), status timeline (the eight statuses collapsed to the customer-relevant five), lines with variant labels, totals, fulfillment (pickup location details or shipping address), payment block (offline: instructions richtext from settings + "Amount due"; card: "Paid" + receipt link), contact email, "Bookmark this page to check status". The page is the one link in emails.

### 7.4 Order lookup (`/shop/orders`)

Form `email + order number` → `POST /api/shop/orders/lookup` (accepts form-encoded and JSON). Match on `emailKey` and `number` → 303 to the status URL (JSON clients get `{ url }`). No match → 303 to `/shop/orders?error=1` (or 404 JSON) after a constant 400 ms delay. Rate limit 10 / 15 min per IP, 20 / day per email key.

## 8. Fulfillment and admin

### 8.1 Admin API (`/api/admin/shop/*`, mounted in `api/admin.ts` from `server/shop/admin-routes.ts`)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /orders` (filters: `status[]`, `payment`, `method`, `q`, `from`, `to`, `cursor`) | `orders.view` | PII included |
| `GET /orders/:id` | `orders.view` | order + events + notifications + stock rows for its lines |
| `POST /orders/:id/transition { to, expectedVersion, note?, trackingNote?, restock? }` | `orders.fulfill` for fulfilment states; `orders.manage` for `cancelled` | §6.2 |
| `POST /orders/:id/payment { method, reference?, expectedVersion }` | `orders.manage` | record an offline payment → `paid` |
| `POST /orders/:id/refund { amountCents, reason, restock, expectedVersion }` | `orders.manage` | provider refund when `stripe`, recorded refund when `offline` |
| `POST /orders/:id/notes { text }` | `orders.fulfill` | |
| `POST /orders/:id/notify { kind }` | `orders.fulfill` | re-send a notification |
| `POST /orders/:id/redact` | `orders.manage` | |
| `POST /orders/bulk-transition { ids: [{id, expectedVersion}], to }` | `orders.fulfill` | from the production report / list selection; partial results reported |
| `GET /orders/export.csv?…filters` | `orders.manage` | audited; cells sanitised against formula injection (`=+-@` prefixed with `'`) |
| `GET /stock`, `POST /stock/:variantId/adjust { setOnHand?, delta?, reason }` | `store.manage` (adjust), `orders.view` (read) | |
| `GET /reports/production?productIds&from&to&statuses` | `orders.view` | product × variant matrix; `?format=csv` |
| `GET /reports/sales?from&to` | `orders.view` | |
| `GET /waitlist`, `DELETE /waitlist/:id`, `POST /waitlist/notify { productId }` | `orders.fulfill` | |
| `GET /payments/status` | `store.manage` | §7.2 |
| `POST /notifications/test` | `store.manage` | sends a test email to the signed-in user's email (if set) via the configured notifier |
| `GET /dashboard` | `orders.view` | card data: pending payment, paid awaiting production, ready for pickup, orders & revenue last 30 days, open pre-order windows closing soon |

All routes: `requirePermission` → validate → `shopStore` → audit (order number only). Errors use the existing envelope.

### 8.2 Admin screens (Preact, under `admin/src/shop/`, same tokens/components as the rest)

Navigation: new sidebar group **Store** (Orders · Pickup mode · Products · Bundles · Categories · Inventory · Reports · Discount codes · Store settings) visible when the user has `orders.view` or `content.read` for the catalog; the mobile tab bar swaps "Events" for "Orders" when the user holds `orders.fulfill` and the store is enabled. "Shop page" appears under Pages.

1. **Orders** `/admin/orders` — status chips with counts (Needs payment, Paid, In production, Ready, Done, Cancelled/Refunded), search (number, name, email, player), date range, fulfillment filter, sort newest first, bulk select → Mark in production / Mark ready / Export CSV. Row: number, customer, items summary ("Hoodie Youth M ×1, +2"), total, payment pill (Unpaid / Paid · Card / Paid · Zelle), fulfillment pill, status, age. Empty state when the store has had no orders yet.
2. **Order detail** `/admin/orders/:id` — header with number, status, big primary action for the natural next step ("Record payment", "Mark ready for pickup", "Mark picked up"), overflow (Mark shipped with tracking note, Cancel, Refund, Re-send email, Redact customer details). Panels: Customer (copy email/phone; mailto), Items (variant, SKU, qty, unit, line; stock state for each), Payment (provider, method, reference, receipt link, refunds; Refund dialog with amount default full, reason, "Return items to stock"), Fulfillment (pickup location or address), Timeline (order events + notifications, newest first), Internal notes (add; `orders.fulfill`). Conflicts on `expectedVersion` show "This order changed — reload" with the new state.
3. **Pickup mode** `/admin/orders/pickup` — phone-first: big search box (name / number / player), filter by pickup location, list of `ready_for_pickup` orders as large cards (customer, player/team, items with sizes, "Paid"/"Unpaid — collect $X" in red), one tap "Picked up" with undo toast (5 s, uses the reverse transition `picked_up → ready_for_pickup` allowed only within 10 min by the same actor), "Record payment" inline for unpaid offline orders (method buttons: Cash, Check #, Zelle, Venmo). Works offline-tolerant: actions queue and retry once; failures stay visible.
4. **Products / Bundles / Categories** — the generic collection list and editor from Phase 7b, plus a product-editor extension panel: "Variants" shows the list editor with a **Generate variants** helper (choose groups and sizes from presets: Youth XS–XL, Adult XS–3XL, One size; colours comma-separated → creates rows with labels and fresh `_key`s, never removes existing rows) and a live **Stock** column (on hand / reserved / sold, "Adjust…" for `store.manage`). Pre-order window fields show "Open now / Opens in 3 days / Closed" helper text.
5. **Inventory** `/admin/store/inventory` — table by product → variant: on hand, reserved, sold, available, sales mode; inline adjust with reason; "Set counts from CSV" is out of scope (noted).
6. **Reports** `/admin/store/reports` — Production report: pick products (default: those with an open or recently closed pre-order window) and statuses (default `paid`, `in_production`); matrix product × variant with totals, "Download CSV", "Mark all paid as in production" bulk action. Sales summary: orders, revenue, refunds, by day sparkline (CSS bars, no chart lib), top products; CSV.
7. **Store settings** `/admin/store/settings` — the `storeSettings` singleton in the generic editor with grouped sections, plus a read-only **Payments** card (provider status) and **Email** card (notifier status, "Send test email").
8. **Dashboard card** — when `orders.view`: "Store" card with the §8.1 dashboard numbers and links; hidden when the store is disabled and has no orders.
9. **Discount codes** `/admin/discountCodes` (Phase 8) — generic collection with a usage column.

### 8.3 Shipping

When `shipping.enabled`: checkout offers "Ship to me (+$X flat)" with an address form (US only, state select, ZIP pattern); non-shippable lines force pickup with a clear message. Admin marks `shipped` with an optional tracking note that appears on the status page and in the `shipped` email. No carrier integration.

## 9. Notifier

`server/shop/notify/{types,log,resend,templates}.ts`.

```ts
interface Notifier { readonly id: 'log' | 'resend'; send(message: { to; subject; text; html; replyTo? }): Promise<{ ok: true; providerId? } | { ok: false; error: string }> }
```

Kinds and triggers: `order_received` (offline order placed; includes amount due and payment instructions), `order_confirmed` (card payment succeeded), `payment_received` (offline payment recorded), `ready_for_pickup` (includes location details and pickupNote), `shipped` (tracking note), `refunded`. Each send is first written to `shop_notifications` (`status: pending`) inside the triggering transaction, then attempted after commit; failures stay `failed` with the error and are retried by cron (max 5) and re-sendable from the order detail. `log` marks them `skipped` with "No email provider configured". Templates: plain text + minimal inline-styled HTML (navy header bar, gold rule, Manrope system fallback), site name from `site`, reply-to from settings, one link (the status URL). Subject lines ≤ 70 chars, e.g. "Prospector order PSC-1042 — ready for pickup". Logs never include the address or body; only `orderId`, `kind`, `status`.

`resend`: `POST https://api.resend.com/emails` with `RESEND_API_KEY`, `from: "${fromName} <${SHOP_FROM_EMAIL}>"`. Requires a verified sending domain (§19 Q9).

## 10. Tax

Implemented as configuration, not policy: `off` (default — no tax line), `flat` (percent on goods, optionally shipping, with a label; the status page and emails show the line), `stripe_tax` (Stripe computes tax at Checkout; the order's `taxCents` is filled from `total_details.amount_tax` on completion; offline orders under `stripe_tax` fall back to `flat` if a rate is set, else `off`, and the checkout page says so). The settings editor shows a help text: "Whether the club must collect California sales tax on merchandise depends on its seller's permit status and nonprofit exemptions. Confirm with the treasurer or CDTFA before enabling." See §19 Q1.

## 11. Security

- **CSRF / cross-site**: every non-GET `/api/shop/*` route (except the webhook) requires `Origin` to equal `PUBLIC_BASE_URL` (dev also allows `http://localhost:5173`) or `Sec-Fetch-Site: same-origin`; JSON routes require `Content-Type: application/json`. The form-encoded lookup route requires the Origin check too.
- **Checkout token**: the `/shop/checkout` render embeds `token = base64url(ts.nonce).hmac` signed with `SESSION_SECRET`; checkout accepts tokens aged 3 s–2 h; the quote endpoint also returns a fresh token. No cookie is needed, so the CDN cache key stays clean for product pages.
- **Honeypot**: hidden `website` field must be empty; filled → 201-shaped fake success with a random order-looking number, nothing stored, rate-limit key incremented (bots keep believing).
- **Rate limits** (store-backed, keyed by hashed IP): quote 60 / min, availability 120 / min, checkout 5 / 10 min, lookup 10 / 15 min per IP and 20 / day per email key, waitlist 10 / h, webhook 600 / min (signature failures count double). 429 with `Retry-After`.
- **Webhooks**: signature verification with timestamp tolerance; claim-then-process idempotency on event id; raw body read once; respond 200 to duplicates and `ignored` types, 400 to bad signatures (never 500 for malformed payloads).
- **Prices**: the client sends identities and quantities only; every total is recomputed server-side from the snapshot at order time and frozen on the order; Stripe line items come from the frozen order, never from the request.
- **Input**: schema-like validation of the checkout body with explicit maxima; emails normalised (`trim`, lower-case key); phone digits/`+ - ( ) space` only; all free text rendered through the `html` escaper (customer notes are plain text; admin notes are plain text).
- **Order access**: 32-byte random token, hash stored, `timingSafeEqual`; the status page and lookup responses are `no-store`, `noindex`, `Referrer-Policy: no-referrer`.
- **PII**: not in audit `meta`, not in logs, not in CDN-cacheable responses, not in error messages; admin list/detail gated by `orders.view`; CSV exports audited.
- **CSV**: RFC 4180 quoting, formula-injection prefix guard, `Content-Disposition: attachment`.
- **CSP**: store pages reuse the public CSP; `shop.js` is a static file under `/assets/js/`, no inline scripts; the checkout redirect uses `location.assign` to Stripe (`https://checkout.stripe.com`) — allowed because it is a navigation, not a fetch.
- **Admin**: all `/api/admin/shop/*` routes inherit session + CSRF + per-session rate limit + `requirePermission`; destructive actions (refund, cancel, redact, export) also require a confirmation dialog in the SPA.
- **Secrets**: only in env; `payments/status` never echoes key material; tests use a local Stripe mock, never real keys.

## 12. Permissions

Additions to `shared/permissions-table.ts` and `server/permissions.ts`:

| Action | Viewer | Contributor | Editor | Admin | Owner |
|---|---|---|---|---|---|
| `orders.view` (list/detail incl. PII, reports, stock read) | | | ✓ | ✓ | ✓ |
| `orders.fulfill` (production/ready/picked up/shipped, notes, re-send, bulk, waitlist) | | | ✓ | ✓ | ✓ |
| `orders.manage` (record payment, refund, cancel, redact, CSV export) | | | | ✓ | ✓ |
| `store.manage` (stock adjustments, provider/notifier status, test email) | | | | ✓ | ✓ |
| Edit `storeSettings` | | | ✓ (`site.settings` ceiling applies to this singleton too) | ✓ | ✓ |
| Edit/publish products, bundles, categories, shop page | existing `content.*` rules | | | | |

`permissionsFor(user)` already feeds the SPA; the shell hides Store screens the user cannot open. Pickup volunteers therefore need **Editor** today (§19 Q7).

## 13. Storefront design

Same design system, same files: tokens from `public/assets/css/styles.css` (`--blue-900/950`, `--gold-500/300`, `--cream`, `--line`, radii, `--cut`, `--shadow`), Barlow Condensed display / Manrope body, existing classes (`.section`, `.section--navy`, `.container`, `.eyebrow`, `.lead`, `.card`, `.pill pill--gold`, `.btn btn--gold|--primary|--ghost`, `.cut-br`, `.rays`, `.steps`, `.faq`, `.tile-grid`). New store-only CSS in `public/assets/css/shop.css` (BEM `shop-*`, `product-*`, `cart-*`, `checkout-*`, `order-*`), loaded only by store pages through a `layout()` option `{ styles: [...], scripts: [...] }` that emits nothing for other pages (golden-tested). Reduced motion respected; `data-reveal` reused.

- **Landing** `/shop`: navy hero with rays motif and the crest, eyebrow "Club shop · 2026–27", title "Wear the gold." (editable), lead, CTAs ("Shop the collection", "How pre-orders work"); category chip row (`.chip-row`); featured grid (3/2/1 columns at 1280/820/390) of product cards — image (`small`, `srcset` with the 1200 variant, `loading=lazy`), name, price ("$50 · youth $45"), availability pill; bundles band (`.section--navy`, featured bundle gets gold `.tier--gold`-style card, "Saves $8"); "How pre-orders work" three steps; shop FAQs; CTA band with contact email. Announcement note (gold) under the header when set.
- **Product** `/shop/p/:slug`: breadcrumb crumbs (`Shop / Apparel / Crest Hoodie`); two-column split (gallery left: primary image with `.cut-br`, thumbnails if >1; buy box right, sticky on desktop): eyebrow tagline, h1, price with youth price note, availability pill with the date ("Pre-order · closes Dec 1 · pickup mid-January"), variant picker as `fieldset`s with `legend` ("Youth sizes", "Adult sizes") and radio pills (44 px targets, disabled + strikethrough label for sold-out/inactive, `aria-describedby` stock text), colour picker when colours exist, quantity stepper (`−` / input / `+`, `inputmode=numeric`, max from availability), "Add to cart" (`btn--gold`), small print "Pay at pickup or by card at checkout", description (richtext), details `dl` (two columns, lookbook style), size guide `<details>`, pickup/shipping note, related products row, "Part of the Coach Kit — save $10" link when a bundle contains it. `<noscript>`: "Adding to the cart needs JavaScript. Email the club to order."
- **Bundle** `/shop/b/:slug`: image, name, price, "Includes" list with a variant picker per component (fixed components show their label), savings, add to cart.
- **Category** `/shop/c/:slug`: title, description, grid.
- **Cart drawer** (`shop.js`): right-side panel (`role=dialog`, focus trap, Esc, scrim) opened on add and from the header cart button (a `.btn--sm` with count badge, injected by the layout when the store is enabled); lines with image, title, variant, qty stepper, remove; subtotal; "Checkout" and "View cart". `aria-live` announcements ("Added Crest Hoodie, Youth M").
- **Cart page** `/shop/cart`: same lines at full width, problems banner when the quote reports changes, discount code field (Phase 8), summary card (subtotal, shipping "calculated at checkout", total), "Continue to checkout".
- **Checkout** `/shop/checkout`: single page, sections as cards: Contact (name, email, phone optional, player name + team when enabled), Fulfillment (radio cards: pickup options with details; "Ship to me (+$8)" with address), Payment (radio cards: "Pay at pickup / Zelle / check" with the instructions preview; "Pay now by card — Stripe" when available), Order summary (sticky on desktop), customer note, honeypot, submit "Place order" / "Continue to payment". Inline validation, error summary at the top with links, disabled double-submit, clear 409 recovery ("Your cart changed: …").
- **Confirmation / status** (§7.3): large order number in Barlow Condensed, status timeline as a horizontal stepper (vertical at 390), next-step card ("Bring $45 cash or Zelle the treasurer before pickup"), items, totals, "Questions? Email …".
- **Lookup**: small centred card; generic error "We couldn't find an order with those details."
- Accessibility: landmarks, labelled controls, `aria-pressed`/radio semantics for pickers, status never colour-only, focus-visible gold ring, 4.5:1 contrast on navy (use `--gold-300` for text on navy), skip link, headings in order. Target Lighthouse a11y ≥ 95 on landing, product, checkout, status (Claude runs).
- Performance: product cards ≤ 50 KB images (`small`), gallery lazy, `shop.js` ≤ 12 KB minified-equivalent plain ES2020 (no build step), no third-party scripts, CDN-cached catalog pages, LCP image preloaded on product pages.

## 14. Environment variables (additive; `.env.example` and `README-deploy.md` updated)

| Var | Dev default | Prod | Purpose |
|---|---|---|---|
| `PAYMENT_PROVIDER` | `offline` | `offline` or `offline,stripe` | enabled providers (comma list) |
| `STRIPE_SECRET_KEY` | – | `sk_live_…` / `sk_test_…` | required when `stripe` listed |
| `STRIPE_WEBHOOK_SECRET` | – | `whsec_…` | required when `stripe` listed (fail fast) |
| `STRIPE_API_BASE` | `https://api.stripe.com` | same | tests point it at the mock |
| `NOTIFIER` | `log` | `log` or `resend` | |
| `RESEND_API_KEY`, `SHOP_FROM_EMAIL` | – | set when `resend` | `SHOP_FROM_EMAIL` on a verified domain |
| `SHOP_REDACT_AFTER_DAYS` | `0` | `0` (off) or e.g. `730` | cron redaction of customer fields |
| `SHOP_RATE_LIMITS` | – | – | optional JSON override of §11 defaults |

`loadConfig` validates combinations (e.g. `stripe` without secrets fails fast in production, warns in dev).

## 15. Testing

Unit (Vitest): `pricing` (every rule in §5 with cents edge cases, rounding, dedupe, caps, bundle selections, youth/override precedence), `availability` (all modes × windows × limits), `transitions` (full matrix, allowed and refused), `stock` reservation/commit/release/restock/adjust invariants, `orderNumber` sequencing, `checkoutToken` (age bounds, tamper), `stripe` signature verification (valid, stale, tampered, missing), webhook idempotency (duplicate event ids, settle vs webhook race), amount-mismatch flagging, `lookup` constant-time and generic failure, `permissions` matrix including the four new actions, `csv` escaping, templates render without PII leaks into logs (spy on console), `catalog` publish validations, render tests for every store page (structure, availability states, `supplier` never emitted, store disabled → 404, nav link conditional, `styles` option emits nothing for non-store pages), goldens unchanged.

HTTP (Hono `app.request`, FS store): shop API happy paths and every guard in §11 (missing Origin → 403, bad token → 403, honeypot → fake 201 and no order, rate limit → 429, cart changed → 409 with quote, shortage race with two concurrent checkouts → exactly one succeeds), admin routes permission matrix (Viewer/Contributor 403, Editor fulfil-only, Admin manage), CAS conflicts, export audited.

Contract (`tests/shop/store-contract.test.ts`): FS always, Postgres when `DATABASE_URL` (reuse `tests/helpers/postgres.ts`): createOrder atomicity (shortage leaves nothing written; number allocation monotonic across concurrent calls), updateOrder CAS, events append-only, payment event claim semantics, expireReservations, reports correctness on a fixture of 30 orders, failure injection at each KV write step with journal replay.

Stripe mock (`tests/helpers/stripe-mock.ts`): a local HTTP server implementing `/v1/checkout/sessions` (create/retrieve), `/v1/coupons`, `/v1/refunds`, with knobs to mark a session paid/expired and to POST a correctly signed webhook to the app. Used by unit/HTTP tests and by the Stripe e2e spec.

E2E (Playwright, Claude runs with Chrome; Codex writes the specs and runs `--list`):
- `shop-slice.spec.ts`: Owner logs in → publishes storeSettings with `enabled: true` + the seeded catalog (via API helper) → `/` shows "Shop" in nav → `/shop` → hoodie → Youth M ×1 and Adult L ×2 → cart drawer → cart page → checkout (pickup, offline) → confirmation shows number and "Amount due" → lookup by email+number works → admin Orders shows it → Record payment (Zelle) → Mark ready → Pickup mode → Picked up → status page shows "Picked up". Run at **390, 820, 1280** px; one keyboard-only pass of product → cart → checkout at 1280.
- `shop-stripe.spec.ts`: provider `offline,stripe` with the mock; choose card → redirect URL points at the mock → mock marks paid + sends webhook → status page "Paid"; second scenario: no webhook, return to status page → settle marks paid; third: session expired → order cancelled and stock released (availability badge updates).
- `shop-admin.spec.ts`: product editor generate variants → stock adjust → sold-out state renders → waitlist join → production report matrix and CSV download → refund with restock → audit log entries present without PII.
- Each spec restores site version 1 and clears `shop/` data in the isolated FS dir afterwards (fixture helper).

Acceptance of every phase includes `npm run build && npm test` (which includes `check:runtime`, now also importing `api/shop.ts`) green, `npm run test:e2e -- --list` green, goldens untouched, no new dependencies, a CHANGELOG entry in `plans/merch-progress.md`.

## 16. Conventions for Codex (in addition to admin-plan §13)

- New code lives in `server/shop/**`, `server/render/shop/**`, `server/store/postgres-schema-shop.sql`, `admin/src/shop/**`, `api/shop.ts`, `public/assets/css/shop.css`, `public/assets/js/shop.js`, `content/seed/{categories,products,bundles,storeSettings,shopPage}.json`, `tests/shop/**`, `tests/e2e/shop-*.spec.ts`. Touch existing files only where this plan names them (schema, permissions table, layout option, handler dispatch, hono-app mount, cdn helpers, cron, seed media, vercel.json, config, Shell navigation, Dashboard card, dev server routing, check-runtime entrypoints).
- NodeNext ESM with explicit `.js` imports; `npm run check:runtime` must stay green and must now exercise `api/shop.ts` (add it to the entrypoints and the smoke: `POST /api/shop/quote` with an empty cart → 200).
- No Stripe/Resend SDKs. HTTP clients are small, typed wrappers with injected `fetch` and base URL for tests.
- Integer cents everywhere in `server/shop/`; the only `× 100` lives in `pricing.ts` `toCents()`.
- Every `ShopStore` write happens inside the shared exclusive section; no partial writes without the journal.
- Progress log for this track is `plans/merch-progress.md` (new): per phase — shipped, verification output, deviations, open issues. Say "not run" explicitly for anything not executed (browsers, Postgres, real Stripe).
- Copy: sentence case, no emojis, no exclamation marks in system messages; customer-facing error copy is kind and specific ("Youth M sold out while you were shopping — we removed it from your cart").
- If a requirement cannot be met within the dependency and function limits, stop and report rather than approximate.

## 17. Phases

Each phase is one Codex run (`codex exec --sandbox workspace-write -m gpt-6.1-sol`, high reasoning), independently testable on the FS driver, reviewed by Fable before the next starts. Phases 1–4 deliver the thin vertical slice (catalog → product page → cart → offline checkout → admin order list → pickup). Sizes S/M/L relative to the admin phases.

### Phase 1 — Catalog foundation (M)
Scope: schema additions (§3: `money.exact`, `text.pattern`, `media.small`, `faqs.page shop`, five collections, `PageName shop`, `SCHEMA_VERSION 2`), `server/shop/catalog.ts` publish validations wired into `validate`, seed files (§3.3) including `media.json` entries for the 20 shop images (`source: static`, `web` = 1200 px, `small` = 480 px, real dimensions), permissions table + `can()` + `permissionsFor` for the four actions, `server/shop/pricing.ts` + `availability.ts` (pure) with exhaustive tests, admin: Store navigation group (Products, Bundles, Categories, Store settings; Shop page under Pages) using the existing generic list/editor, product editor "Generate variants" panel (no stock column yet), `money.exact` and slug controls in the form engine, `plans/merch-progress.md` created.
Acceptance: `npm run seed` loads the catalog as drafts and the two singletons as published; all eight goldens pass unchanged; admin can create/edit/preview-validate/publish a product and a bundle (HTTP tests); publish of a bundle whose component is unpublished is refused with a path; pricing tests cover §5 line by line; Viewer/Contributor get 403 on a stubbed `orders.view` route check (table test).

### Phase 2 — Storefront and cart (L) — design review by Fable/Claude in the browser
Scope: `server/render/shop/{landing,product,bundle,category,cart,checkout,lookup,status-shell}.ts`, `layout()` `styles/scripts` option, header cart button + nav link when enabled, handler dispatch for `/shop*` (+ dev server routing, `vercel.json` rewrites, sitemap conditional), store-disabled 404 / coming-soon / preview behaviour, `public/assets/css/shop.css`, `public/assets/js/shop.js` (cart store, drawer, pickers, quantity, quote rendering, availability refresh, checkout form handling with 409 recovery — checkout POST itself lands in Phase 3 but the client is written against §7.1), `api/shop.ts` Hono app with `/quote` and `/availability` (Origin/content-type/rate-limit middleware, token minting), `tagShop/purgeShop`. Stock reads use a temporary in-memory `ShopStore` stub exposing `getStock` (returns empty → everything behaves as pre-order/unlimited) so this phase has no storage dependency.
Acceptance: render tests for every page and state in §13; `/shop` 404 when disabled and 200 under `?preview=1` with a session; `curl /shop/p/crest-hoodie` after enabling via publish returns SSR HTML with variant radios, `Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=60`; quote returns priced lines and problems for an unknown variant; goldens unchanged; `check:runtime` includes `api/shop.ts`; Codex reports a manual walkthrough on the dev server at 390/820/1280 with the browser pane unavailable noted as "not run (sandbox)".

### Phase 3 — Orders, stock ledger and offline checkout (L) — Fable deep review (money, concurrency, security)
Scope: `ShopStore` interface, `KvShopStore` (journaled), `PostgresShopStore`, `postgres-schema-shop.sql` + migrate wiring, contract tests incl. concurrency and failure injection, `transitions.ts`, `orders.ts` (create, number allocation, token), checkout route with all §11 guards, `offline` provider, confirmation/status page and lookup route, `Notifier` interface + `log` implementation + templates + notifications ledger, reservation expiry in cron + lazy (`claimMaintenance('shop-expiry', 60000)`), `shop.js` checkout submission wired end to end, `.env.example`/README additions.
Acceptance: HTTP test places an offline order from a quote and reads the status page with the token; wrong token → 404 identical to unknown; two concurrent checkouts for the last unit → one 201 and one 409 with a shortage, stock shows `reserved = 1`; expiry cancels an unpaid card-style reservation after `reservationMinutes` and releases stock; lookup rate limit and generic failure; honeypot yields no order; every write produces an order event; contract suite green on FS (Postgres "not run (no env)" acceptable, but the SQL is applied in a unit test against the parser-level fixture if available).

### Phase 4 — Admin orders and the slice e2e (M) — completes the vertical slice
Scope: `/api/admin/shop/orders*` (list, detail, transition, payment, notes, bulk, export CSV), `/api/admin/shop/dashboard`, admin screens Orders, Order detail, Pickup mode, Dashboard "Store" card, mobile tab swap, `tests/e2e/shop-slice.spec.ts` with the e2e fixture that clears `shop/` data, progress log.
Acceptance: HTTP permission matrix for all routes; transition table enforced (409 on invalid, CAS conflict surfaced); CSV export audited and formula-safe; Playwright `--list` green; Claude runs the slice at three widths and keyboard-only and records results; Lighthouse a11y ≥ 95 on `/shop`, product, checkout and the Orders screen (Claude).

### Phase 5 — Stripe provider (M) — Fable deep review
Scope: `payments/stripe.ts` (§7.2), webhook route, settle on return, refunds, amount-mismatch flag, `payments/status`, provider selection in checkout UI (radio cards), config validation, Stripe mock helper, `tests/e2e/shop-stripe.spec.ts`, README section "Enabling card payments" (create Stripe account → restricted key with Checkout + Refunds scopes → webhook endpoint URL and events → env → redeploy → test mode first).
Acceptance: signature tests (valid/stale/tampered); duplicate webhook → single transition and single notification; settle path marks paid without a webhook; expired session cancels and releases; refund via mock records provider id and optional restock; keys never appear in any response or log (grep in tests); Playwright `--list` green and Claude runs the spec.

### Phase 6 — Pre-order operations, inventory, waitlist, reports (M)
Scope: stock column + Adjust in the product editor, Inventory screen, production report (matrix, CSV, bulk "Mark in production"), sales summary, pre-order window states and copy on the storefront (opens soon / closes in N days / closed), per-variant limits, waitlist (public join form on sold-out/waitlist products, admin list, "Notify waitlist" composing a `back_in_stock` notification when a variant becomes available), purge `shop` on stock changes, dashboard card additions (windows closing soon).
Acceptance: report fixture totals match hand-computed values; adjusting stock to 0 renders "Sold out" and `/availability` agrees; waitlist dedupes by email per product; bulk transition reports partial failures; audit entries for adjustments carry reason and delta only.

### Phase 7 — Fulfillment polish and email (M) — design review in the browser
Scope: shipping (settings, address form + validation, flat rate / free-over, `shipped` with tracking note, non-shippable handling), Pickup mode polish (undo window, inline record payment, location filter, offline-tolerant queue), status page timeline and copy, `resend` notifier + test email + retry cron + re-send button, email template review (text + HTML), notification history in order detail, `tests/e2e/shop-admin.spec.ts` (pickup flows added).
Acceptance: shipping totals and free-over threshold tested; a non-shippable line cannot be shipped (422 + UI); emails rendered for every kind in a snapshot-style test with no PII beyond the recipient fields; `NOTIFIER=resend` with a mocked endpoint marks sent and records the provider id; Claude runs the admin spec at 390/820/1280.

### Phase 8 — Discount codes, tax modes, retention (M, optional — ship only if phases 1–7 are clean)
Scope: `discountCodes` collection (code, type percent/fixed, value, appliesTo all/bundles/products, startsAt/endsAt, maxUses, minSubtotal, active) with publish validation; usage ledger claim/release tied to order creation/cancel; cart and checkout code field; Stripe coupon mapping; `tax.mode` `flat` and `stripe_tax` end to end (status page, emails, CSV, reports); redaction action + cron (`SHOP_REDACT_AFTER_DAYS`); sales report tax/discount columns.
Acceptance: discount rules unit-tested (caps, exhaustion race → exactly `maxUses` orders succeed, expiry, scope); totals with tax verified for flat mode; `stripe_tax` session carries `automatic_tax`; redaction keeps totals and lines, removes customer fields, is audited, and the status page still works with the token.

### Phase 9 — Hardening and launch readiness (S/M) — Fable security pass
Scope: security checklist walk (§11) with tests for any gap, rate-limit tuning via `SHOP_RATE_LIMITS`, a11y fixes from Claude's Lighthouse runs, performance (preload LCP image, `srcset` audit, cache headers), `README-shop.md` (how the store works for volunteers: enabling, pre-order windows, pickup day, recording payments, refunds, exports) and `README-deploy.md` additions (Vercel plan note, env, `npm run db:migrate` for schema 2, Stripe webhook registration, enabling the store by publishing settings), final full e2e run at three widths (Claude), progress log closure.
Acceptance: all specs green in Chrome; `npm test` green; `check:runtime` green on Node 22.12; deploy checklist complete; no open "not run" items except real Stripe live keys.

Review cadence: Fable reviews every phase diff before the next run; phases 3, 5 and 8 get a deep review (money paths, concurrency, webhook idempotency, PII); phases 2, 4 and 7 get a browser design/a11y pass by Claude at 390/820/1280. Suggest a Codex second-opinion review (`codex review`) after phases 3 and 5 only if Chris asks.

## 18. Risks and mitigations

- **Vercel Hobby terms**: selling merchandise is commercial use; the Hobby plan prohibits it. The store must launch on **Pro** (also gives hourly cron and more function headroom). Flagged in §19 Q2; nothing in the code depends on the plan.
- **Stripe without an SDK**: a small REST surface (sessions, coupons, refunds, signature). Mitigated by the mock server, pinned API version, and tests for signature and idempotency; if the surface grows (Payment Element, Tax reporting), reconsider adding `stripe` as a dependency in a later phase with explicit approval.
- **Stale availability on cached pages**: bounded by 15 s + 60 s SWR, JS refresh on load, and the server-authoritative 409 at checkout with clear copy.
- **Reservation leaks** after crashes: journaled writes, expiry job (cron daily on Hobby, hourly on Pro) plus lazy expiry on every shop/admin request, inspectable on the Inventory screen ("reserved" column with order links).
- **Offline payments never recorded**: the Orders screen "Needs payment" chip, the dashboard count, the auto-cancel after `offlineHoldDays`, and the pickup screen's red "collect $X" keep it visible.
- **Email deliverability**: Resend requires a verified domain; until then `log` mode shows volunteers which emails would have gone out so they can call or text.
- **Scope creep**: no customer accounts, no carrier APIs, no print-on-demand integration, no multi-currency, no gift cards, no per-variant images beyond colour swatches, no CSV import of stock. Each is a later plan if the club asks.
- **Large phases (2, 3)**: each has mechanical scope and objective acceptance; split 3 into 3a (store + contract tests) and 3b (checkout + pages) if a run stalls.

## 19. Open questions for Chris

1. **Sales tax**: does the club hold a California seller's permit, and does the treasurer want tax collected (flat rate for El Dorado County) or left off for the launch? The code supports `off / flat / stripe_tax`; the default is `off`.
2. **Vercel plan**: the live project is presumably on Hobby; selling merch requires Pro. OK to upgrade before enabling the store?
3. **Payments at launch**: offline only (pay the treasurer at pickup / Zelle / Venmo / check) until the board opens a Stripe account? If Stripe: whose account (club EIN, nonprofit pricing), and who receives payout and webhook alerts?
4. **Offline payment instructions**: exact text for the settings (Zelle/Venmo handle, who to make checks out to, payment deadline before pickup).
5. **Pickup locations and the first window**: which practices/events (Cameron Park Saturdays? AGM in December?), and the first pre-order window dates and expected delivery for the launch set (lookbook suggested hoodie, fan tee, cap, scarf, decal).
6. **Retention and privacy**: keep orders indefinitely (financial record) with manual redaction, or auto-redact customer details after N years? Default: keep, manual redaction only.
7. **Who checks people off at pickup**: are these Editor-level people? If not, we can add a narrow "Volunteer" role (orders.view + orders.fulfill only) in a small follow-up.
8. **Youth pricing inside bundles**: bundle price stays fixed regardless of youth/adult selections (simplest, matches the lookbook). OK?
9. **Email sender**: is `prospector.org` (or another domain) available to verify with Resend, and which address should be the reply-to (communications director)?
10. **Shipping**: offer flat-rate shipping at launch (rate?), or pickup only?
11. **Refund/exchange policy** text for the store policies section, and whether volunteers may issue partial refunds.
12. **Board approval**: the seed marks products as drafts; who publishes them, and should the "concept" images be replaced by supplier photos before launch?

## Build defaults (Claude, 2026-11-09 — pending Chris's answers; none block building)

- Store ships **disabled** (`storeSettings.enabled=false`) with the 10 products + 3 bundles as drafts at the concept-lookbook prices. Prices are expected to change after supplier quotes (see plans/merch/Prospector-Local-Merch-Suppliers.pdf: hoodie/cap/blanket/backpack/decal costs exceed or approach the lookbook retail).
- Payments: `offline` provider default; `stripe` implemented and tested against a mocked provider/test mode only. No live keys.
- Tax: `off`. Shipping: pickup only (flat-rate shipping implemented but disabled). Notifier: `log`.
- Retention: keep orders indefinitely with manual redaction. Bundles: fixed price regardless of youth/adult picks.
- Pickup volunteers: use existing Editor role for v1.
- Do NOT enable the store on the production deployment: Vercel Hobby's terms are non-commercial; Chris must decide on Pro (or another host) first.

## Scope decision (Chris, 2026-11-09): proof of concept only

The merch store is a **proof of concept for the local non-profit**. It will **not** go live on the current Vercel (Hobby) plan.
- The `merch-store` branch is never merged into `admin-cms` and never handed to ChrisBot for deployment. Demo it locally (`npm run start`) with screenshots/recordings.
- Build phases 1–4 (vertical slice), 6 (pre-order ops + production report) and 7 (pickup fulfillment; notifier stays `log`). Phase 5 Stripe: implement only the adapter shape + a mocked provider for the demo; no live/test Stripe account. **Skip** phase 8 (discounts/tax/retention). Phase 9: only the hardening items needed for a credible demo.

## Scope revision (Chris, 2026-11-09, supersedes the POC section above)

The store goes **live but unusable**: deployed to production as a browsable showcase, clearly labeled **"Proof of concept only"**, with **checkout disabled**.
- Visible: nav link "Merch (concept)", /shop, product pages, bundles, cart (add/remove/quantities work).
- Every shop page carries a prominent "Proof of concept only — no orders are accepted" banner/label; product pages say prices are illustrative.
- Checkout is disabled defence-in-depth: (1) env `SHOP_CHECKOUT=disabled` (default when unset in production) — server refuses checkout/order creation/payment/webhook routes with a 403 `checkout_disabled` and the admin cannot override it; (2) UI replaces checkout CTAs with a disabled "Checkout disabled — proof of concept" state; (3) no payment provider credentials exist.
- Build scope: phases 1–2 + this POC mode, then merge `merch-store` into `admin-cms` for deployment by ChrisBot. Phases 3–9 (orders, payments, pickup, reports) are deferred unless Chris asks later.
