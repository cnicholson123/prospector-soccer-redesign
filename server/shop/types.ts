import type { Snapshot } from '../../shared/types.js';
export interface Money { amount: number }
export interface Variant { _key: string; label: string; group: 'youth' | 'adult' | 'one-size'; sku?: string; color?: string; priceOverride?: Money; active?: boolean; limit?: number }
export interface Product { name: string; slug: string; categoryId: string; price: Money; youthPrice?: Money; variants: Variant[]; salesMode: 'preorder' | 'stock' | 'waitlist'; preorder?: { opensAt?: string; closesAt?: string; expectedDelivery?: string; note?: string }; allowWaitlist?: boolean; shippable?: boolean }
export interface Bundle { name: string; slug: string; price: Money; components: { _key: string; productId: string; quantity: number; fixedVariantKey?: string }[]; shippable?: boolean }
export interface Settings { enabled?: boolean; orders?: { maxQuantityPerLine?: number }; shipping?: { enabled?: boolean; flatRate?: Money; freeOver?: Money }; tax?: { mode?: 'off' | 'flat' | 'stripe_tax'; flatRatePercent?: number; taxShipping?: boolean } }
export interface StockRow { onHand: number; reserved: number; sold: number }
export type Stock = Record<string, StockRow>;
export type CartLine = { kind: 'product'; productId: string; variantKey: string; quantity: number } | { kind: 'bundle'; bundleId: string; selections: Record<string, string>; quantity: number };
export interface Problem { code: 'qty_capped' | 'unavailable' | 'pickup_only'; message: string; line: number }
export interface PricedComponent { productId: string; variantKey: string; title: string; variantLabel: string; quantity: number; salesMode: Product['salesMode']; sku?: string }
export type PricedLine = CartLine & { title: string; variantLabel: string; sku?: string; image?: string; unitCents: number; lineCents: number; salesMode: Product['salesMode']; shippable: boolean; components?: PricedComponent[]; problems: Problem[] };
export interface Totals { subtotalCents: number; discountCents: number; shippingCents: number; taxCents: number; totalCents: number; taxMode: string; taxRateBps?: number; currency: 'usd' }
export interface Quote { lines: PricedLine[]; totals: Totals; problems: Problem[] }
export function productReady(p: Partial<Product>): p is Product {
  return !!p.price && Number.isFinite(p.price.amount) && Array.isArray(p.variants) && p.variants.length > 0 && p.variants.every(v => !!v._key && !!v.label && ['youth', 'adult', 'one-size'].includes(v.group)) && ['preorder', 'stock', 'waitlist'].includes(p.salesMode ?? '');
}
export function catalog<T>(snapshot: Snapshot, collection: 'products' | 'bundles'): Map<string, T> { return new Map((snapshot.docs[collection] ?? []).filter(d => { const value = d.data as Partial<Product & Bundle>; return collection === 'products' ? productReady(value) : !!value.price && Number.isFinite(value.price.amount) && Array.isArray(value.components) && value.components.length >= 2 && value.components.every(c => Number.isSafeInteger(c.quantity) && c.quantity >= 1); }).map(d => [d.id, d.data as T])); }
