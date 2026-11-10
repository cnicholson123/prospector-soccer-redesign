import { beforeEach, expect, it } from 'vitest';
import { catalogFixture } from './fixtures.js';
import { SnapshotView } from '../../server/render/snapshot-view.js';
import { renderShop } from '../../server/render/shop/index.js';
import { statusShell } from '../../server/render/shop/status-shell.js';
import { createRenderHandler, renderPage } from '../../server/render/handler.js';
import { loadConfig } from '../../server/config.js';
import { layout } from '../../server/render/templates/layout.js';
import { html } from '../../server/render/html.js';
import type { Store } from '../../server/store/types.js';
import type { Stock } from '../../server/shop/types.js';
let f: Awaited<ReturnType<typeof catalogFixture>>;
beforeEach(async()=>{f=await catalogFixture();});
function render(path:string,stock:Stock={}) {return renderShop({view:new SnapshotView(f.snapshot,new Date('2026-11-09T20:00:00Z')),stock},path,{secret:'s'.repeat(32)});}
it.each(['','p/crest-hoodie','b/coach-kit','c/apparel','cart','checkout','orders'])('renders %s without emitting internal supplier fields', path=>{
 const result=render(path);expect(result.status).toBe(200);expect(result.body).toContain('shop.css');expect(result.body).toContain('shop.js');expect(result.body).not.toContain('Planning estimate only');expect(result.body).not.toContain('estimatedCost');expect(result.body).not.toContain('Supplier');
});
it('renders the landing content, responsive image variants, categories and bundle savings',()=>{
 const {body}=render('');for(const text of ['Wear the','Ten pieces','Imagine your club gear','Apparel','New Family Pack','Saves $9','Saves $8','Saves $10','srcset=','480w'])expect(body).toContain(text);
});
it('formats fractional product and youth prices consistently on cards and detail pages',()=>{
 f.product.price={amount:45.5};f.product.youthPrice={amount:35.5};
 for(const path of ['', 'p/crest-hoodie']){
  const {body}=render(path);expect(body).toContain('$45.50');expect(body).toContain('youth $35.50');
 }
});
it('renders grouped radios, stable variant IDs, quantities, size guide and bundle links',()=>{
 const {body}=render('p/crest-hoodie');for(const text of ['Youth sizes','Adult sizes','type="radio"','prod_hoodie.00000001','inputmode="numeric"','aria-describedby=','Size guide','Part of the Coach Kit','JavaScript','rel="preload"'])expect(body).toContain(text);
 expect(body).toContain('Youth XS');expect(body).toContain('Adult 3XL');
});
it('renders fixed bundle labels and selectable components',()=>{const {body}=render('b/new-family-pack');expect(body).toContain('selection-0');expect(body).toContain('selection-1');expect(body).toContain('Set of 4');expect(body).toContain('Saves $9');});
it('renders category products only',()=>{const {body}=render('c/apparel');expect(body).toContain('Crest Hoodie');expect(body).toContain('Gold Country Fan Tee');expect(body).not.toContain('<h3>Pom Beanie</h3>');});
it.each(['waitlist','stock','preorder'] as const)('renders disabled and available states for %s',salesMode=>{
 f.product.salesMode=salesMode;
 if(salesMode==='preorder')f.product.preorder={closesAt:'2020-01-01T00:00:00Z'};
 const {body}=render('p/crest-hoodie');expect(body).toContain('disabled');expect(body).toContain(salesMode==='waitlist'?'Join the waitlist':salesMode==='stock'?'Sold out':'Pre-orders closed');
});
it('shows low stock and caps controls',()=>{f.product.salesMode='stock';const {body}=render('p/crest-hoodie',{'prod_hoodie.00000001':{onHand:3,reserved:1,sold:1}});expect(body).toContain('Only 1 left');expect(body).toContain('data-cap="1"');});
it('escapes malicious catalog copy and never injects raw HTML',()=>{f.product.name='<script>alert(1)</script>';const {body}=render('p/crest-hoodie');expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');expect(body).not.toContain('<script>alert(1)');});
it('keeps missing and unverified status URLs uniformly private 404s',()=>{for(const path of ['p/unknown','b/unknown','c/unknown','order/PSC-1001','order/PSC-1001?t=bad'])expect(render(path)).toMatchObject({status:404,private:true});expect(statusShell().toString()).toContain('Order status');});
it('hides disabled store, supports coming soon and preserves preview navigation',()=>{
 f.settings.enabled=false;expect(render('').status).toBe(404);
 const s=f.snapshot.docs.storeSettings![0].data as Record<string,unknown>;s.comingSoon={enabled:true,title:'Coming soon',text:'Ready for kickoff'};
 expect(render('').body).toContain('Ready for kickoff');
 const preview=renderShop({view:new SnapshotView(f.snapshot),stock:{}},'',{preview:true,secret:'x'.repeat(32)});
 expect(preview.body).toContain('href="/shop/p/crest-hoodie?preview=1"');expect(preview.body).toContain('name="robots" content="noindex"');
});
it('adds navigation conditionally and keeps shop styles opt-in on ordinary pages',()=>{
 expect(renderPage(f.snapshot,'home')).toContain('href="/shop"');expect(renderPage(f.snapshot,'home')).not.toContain('data-cart-open');expect(renderPage(f.snapshot,'home')).not.toContain('shop.css');
 f.settings.enabled=false;expect(renderPage(f.snapshot,'home')).not.toContain('data-cart-open');
 const v=new SnapshotView(f.snapshot);expect(layout(v,'home',html`<p>Content</p>`).toString()).not.toContain('shop.css');expect(layout(v,'home',html``,undefined,{styles:['/extra.css'],scripts:['/extra.js']}).toString()).toContain('/extra.css');
});
it('conditionally includes catalog URLs in sitemap and marks private pages no-store',async()=>{
 const config=loadConfig({SESSION_SECRET:'x'.repeat(32)},()=>{});
 const store={getSnapshot:async()=>f.snapshot} as unknown as Store;
 const site=f.snapshot.docs.site![0].data as {seo:{indexable:boolean}};site.seo.indexable=true;
 let handler=createRenderHandler(store,config);
 expect(await(await handler(new Request('http://localhost:3000/sitemap.xml'))).text()).toContain('/shop/p/crest-hoodie');
 for(const path of ['cart','checkout','orders','order/PSC-1001']){ const response=await handler(new Request('http://localhost:3000/shop/'+path));expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer'); }
 f.settings.enabled=false;handler=createRenderHandler(store,config);expect(await(await handler(new Request('http://localhost:3000/sitemap.xml'))).text()).not.toContain('/shop');
});
it('previews partially saved drafts without crashing or offering them for purchase',()=>{
 f.snapshot.docs.products!.push({id:'prod_partial',collection:'products',version:1,order:100,data:{name:'Partial',slug:'partial',featured:true}});
 f.snapshot.docs.bundles!.push({id:'bundle_partial',collection:'bundles',version:1,order:100,data:{name:'Partial bundle',slug:'partial-bundle'}});
 expect(render('').status).toBe(200);expect(render('p/partial').body).toContain('Price pending');expect(render('p/partial').body).toContain('disabled');expect(render('b/partial-bundle').status).toBe(200);
});

it.each(['','p/crest-hoodie','b/coach-kit','c/apparel','cart','checkout','orders','order/PSC-1001','p/missing'])('labels every shop route %s and exposes no checkout form by default',path=>{
 const {body}=render(path);
 expect(body).toContain('aria-label="Proof of concept only"');
 expect(body).toContain('No orders are accepted. Prices are illustrative.');
 expect(body.indexOf('shop-poc-banner')).toBeGreaterThan(body.indexOf('</header>'));
 expect(body).not.toContain('data-checkout');expect(body).not.toContain('action="/api/shop/checkout"');expect(body).not.toContain('name="token"');
 expect(body).toContain('Proof of concept only — no orders are accepted. Prices are illustrative.');
});
it('keeps ordinary public pages unchanged except the concept navigation',()=>{
 const body=renderPage(f.snapshot,'home');
 expect(body).toContain('Merch (concept)');
 expect(body).not.toContain('data-cart-open');expect(body).not.toContain('cart-drawer');expect(body).not.toContain('shop.js');
 expect(body).not.toContain('shop.css');expect(body).not.toContain('shop-poc-banner');
});
it.each(['disabled',undefined])('renders HTTP checkout without a form for SHOP_CHECKOUT=%s',async SHOP_CHECKOUT=>{
 const config=loadConfig({SHOP_CHECKOUT,SESSION_SECRET:'x'.repeat(32)},()=>{});
 const store={getSnapshot:async()=>f.snapshot} as unknown as Store;
 const response=await createRenderHandler(store,config)(new Request('http://localhost:3000/shop/checkout'));
 const body=await response.text();expect(response.status).toBe(200);expect(body).toContain('Checkout is disabled');expect(body).not.toContain('<form');
});
it('allows the future checkout form only with explicit development opt-in',async()=>{
 const config=loadConfig({SHOP_CHECKOUT:'enabled',NODE_ENV:'development',SESSION_SECRET:'x'.repeat(32)},()=>{});
 const store={getSnapshot:async()=>f.snapshot} as unknown as Store;
 const body=await(await createRenderHandler(store,config)(new Request('http://localhost:3000/shop/checkout'))).text();
 expect(body).toContain('data-checkout');expect(body).toContain('Proof of concept only');
});

it.each(['disabled',undefined])('labels every HTTP shop page when checkout is %s',async SHOP_CHECKOUT=>{
 const config=loadConfig({SHOP_CHECKOUT,SESSION_SECRET:'x'.repeat(32)},()=>{});
 const handler=createRenderHandler({getSnapshot:async()=>f.snapshot} as unknown as Store,config);
 for(const path of ['','/p/crest-hoodie','/b/coach-kit','/c/apparel','/cart','/checkout','/orders','/order/PSC-1001']) {
  const response=await handler(new Request('http://localhost:3000/shop'+path));const body=await response.text();
  expect(body).toContain('aria-label="Proof of concept only"');
  expect(body).toContain('Proof of concept only — no orders are accepted. Prices are illustrative.');
  expect(body).not.toContain('data-checkout');expect(body).not.toContain('action="/api/shop/checkout"');
 }
});
