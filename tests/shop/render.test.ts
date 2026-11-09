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
 const {body}=render('');for(const text of ['Wear the','Ten pieces','How pre-orders work','Apparel','New Family Pack','Saves $9','Saves $8','Saves $10','srcset=','480w'])expect(body).toContain(text);
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
 expect(renderPage(f.snapshot,'home')).toContain('href="/shop"');expect(renderPage(f.snapshot,'home')).toContain('data-cart-open');expect(renderPage(f.snapshot,'home')).not.toContain('shop.css');
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
