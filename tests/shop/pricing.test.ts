import { beforeEach, describe, expect, it } from 'vitest';
import { catalogFixture } from './fixtures.js';
import { price, toCents } from '../../server/shop/pricing.js';
import type { CartLine, Stock } from '../../server/shop/types.js';
let f: Awaited<ReturnType<typeof catalogFixture>>;
beforeEach(async () => { f = await catalogFixture(); });
const hoodie = (quantity = 1, variantKey = '00000001'): CartLine => ({ kind: 'product', productId: 'prod_hoodie', variantKey, quantity });
const coach = (quantity = 1): CartLine => ({ kind: 'bundle', bundleId: 'bundle_coach-kit', selections: { 0: '00000001', 1: '00000001', 2: '00000001' }, quantity });
function quote(lines: CartLine[], stock: Stock = {}, options: Parameters<typeof price>[4] = {}) { return price(f.snapshot, stock, f.settings, lines, options); }
describe('integer pricing', () => {
  it.each([[0,0], [.01,1], [.29,29], [1.005,100], [19.99,1999]])('converts dollars %s only at the boundary', (amount, expected) => expect(toCents({amount})).toBe(expected));
  it.each([-1,Infinity,NaN,Number.MAX_VALUE])('rejects invalid money %s', amount => expect(() => toCents({amount})).toThrow());
  it('uses youth, adult and override precedence, including zero', () => {
    expect(quote([hoodie()]).totals.totalCents).toBe(4500);
    expect(quote([hoodie(1,'00000006')]).totals.totalCents).toBe(5000);
    f.product.variants[0].priceOverride = { amount: 0 };
    expect(quote([hoodie()]).totals.totalCents).toBe(0);
  });
  it('deduplicates variants and canonical bundle selections', () => {
    const q = quote([hoodie(2), hoodie(3), coach(), { ...coach(), selections: { 2:'00000001', 1:'00000001', 0:'00000001' } } as CartLine]);
    expect(q.lines.map(l => l.quantity)).toEqual([5,2]); expect(q.lines[1].unitCents).toBe(9500);
  });
  it('keeps bundle prices fixed for youth selections and quantities', () => { const q=quote([coach(2)]); expect(q.totals.totalCents).toBe(19000); expect(q.lines[0].components).toHaveLength(3); });
  it('applies fixed component choices instead of caller selections', () => {
    const q=quote([{kind:'bundle',bundleId:'bundle_new-family-pack',selections:{0:'00000001',1:'bad',2:'bad'},quantity:1}]);
    expect(q.problems).toEqual([]); expect(q.totals.totalCents).toBe(4000);
  });
  it.each([0,-4,1.2,11,10000])('clamps quantity %s with a problem', n => { const q=quote([hoodie(n)]); expect(q.problems[0].code).toBe('qty_capped'); expect(q.lines[0].quantity).toBe(Math.max(1,Math.min(10,Math.trunc(n)))); });
  it('reports unknown products, variants, bundles and incomplete selections without charging', () => {
    for(const line of [{...hoodie(),productId:'missing'},{...hoodie(),variantKey:'missing'},{...coach(),bundleId:'missing'},{...coach(),selections:{}}] as CartLine[]) { const q=quote([line]); expect(q.problems.some(p=>p.code==='unavailable')).toBe(true); expect(q.totals.totalCents).toBe(0); }
  });
  it('checks stock cumulatively across individual products and bundles', () => {
    f.product.salesMode='stock'; const q=quote([hoodie(2),coach(2)],{'prod_hoodie.00000001':{onHand:3,reserved:0,sold:0}});
    expect(q.lines.map(l=>l.quantity)).toEqual([2,1]); expect(q.problems.some(p=>p.code==='qty_capped')).toBe(true);
  });
  it('aggregates repeated components within one bundle before checking stock', () => {
    f.product.salesMode='stock'; f.bundle.components[1]={...f.bundle.components[0]};
    const q=quote([coach(2)],{'prod_hoodie.00000001':{onHand:3,reserved:0,sold:0}}); expect(q.lines[0].quantity).toBe(1);
  });
  it('requires pickup for a non-shippable component', () => { f.product.shippable=false; expect(quote([coach()],{}, {fulfillment:{method:'shipping'}}).problems[0].code).toBe('pickup_only'); });
  it('applies discounts, threshold shipping, flat tax and half-up rounding in order', () => {
    f.settings.shipping={enabled:true, flatRate:{amount:8},freeOver:{amount:50}};
    f.settings.tax={mode:'flat',flatRatePercent:7.25,taxShipping:true};
    const q=quote([hoodie(2)],{}, {discount:{type:'percent',value:50},fulfillment:{method:'shipping'}});
    expect(q.totals).toMatchObject({subtotalCents:9000,discountCents:4500,shippingCents:800,taxCents:384,totalCents:5684});
    expect(quote([hoodie(2)],{}, {fulfillment:{method:'shipping'}}).totals.shippingCents).toBe(0);
    f.settings.tax.taxShipping=false; expect(quote([hoodie()],{},{fulfillment:{method:'shipping'}}).totals.taxCents).toBe(326);
  });
  it.each(['off','stripe_tax'] as const)('leaves tax at zero for %s', mode => { f.settings.tax={mode,flatRatePercent:10}; expect(quote([hoodie()]).totals.taxCents).toBe(0); });
  it('caps discounts at subtotal and never returns negative totals', () => { expect(quote([hoodie()],{}, {discount:{type:'fixed',value:100000}}).totals).toMatchObject({discountCents:4500,totalCents:0}); expect(quote([]).totals.totalCents).toBe(0); });
  it('rounds half cents up and ignores prices injected into cart identities', () => { f.product.youthPrice={amount:.05}; expect(quote([{...hoodie(),unitCents:1} as unknown as CartLine],{}, {discount:{type:'percent',value:10}}).totals).toMatchObject({subtotalCents:5,discountCents:1,totalCents:4}); });
});
