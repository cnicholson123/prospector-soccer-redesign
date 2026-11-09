import type { Product, Variant, StockRow } from './types.js';
export interface Availability { available: boolean; cap: number; state: 'preorder' | 'upcoming' | 'closed' | 'stock' | 'low' | 'sold_out' | 'waitlist' | 'inactive'; label: string }
export function availability(product: Product, variant: Variant, stock: StockRow | undefined, now = new Date(), maxQuantity = 10): Availability {
  const result = (state: Availability['state'], cap: number, label: string): Availability => ({ state, cap: Math.max(0, Math.floor(cap)), available: cap > 0, label });
  if (variant.active === false) return result('inactive', 0, 'Unavailable');
  if (product.salesMode === 'waitlist') return result('waitlist', 0, 'Join the waitlist');
  const used = (stock?.reserved ?? 0) + (stock?.sold ?? 0);
  if (product.salesMode === 'stock') {
    const remaining = Math.max(0, (stock?.onHand ?? 0) - used);
    return remaining ? result(remaining <= 5 ? 'low' : 'stock', remaining, remaining <= 5 ? `Only ${remaining} left` : 'In stock') : result('sold_out', 0, product.allowWaitlist ? 'Sold out · join the waitlist' : 'Sold out');
  }
  const date = (s: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date(s));
  if (product.preorder?.opensAt && Date.parse(product.preorder.opensAt) > now.getTime()) return result('upcoming', 0, `Pre-order opens ${date(product.preorder.opensAt)}`);
  if (product.preorder?.closesAt && Date.parse(product.preorder.closesAt) <= now.getTime()) return result('closed', 0, 'Pre-orders closed');
  const remaining = variant.limit === undefined ? maxQuantity : Math.max(0, variant.limit - used);
  if (!remaining) return result('sold_out', 0, product.allowWaitlist ? 'Sold out · join the waitlist' : 'Sold out');
  return result('preorder', remaining, 'Pre-order' + (product.preorder?.closesAt ? ` · closes ${date(product.preorder.closesAt)}` : '') + (product.preorder?.expectedDelivery ? ` · pickup ${product.preorder.expectedDelivery}` : ''));
}
