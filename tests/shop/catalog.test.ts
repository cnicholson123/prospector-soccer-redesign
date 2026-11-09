import { beforeEach, expect, it } from 'vitest';
import { catalogFixture } from './fixtures.js';
import { validate, validateFields } from '../../server/content/validate.js';
import { loadSeed } from '../../scripts/seed.js';
import { can, permissionsFor } from '../../server/permissions.js';
import { roles } from '../../shared/permissions-table.js';
import type { User } from '../../shared/types.js';
import { generateVariants } from '../../admin/src/shop/CatalogTools.js';
import { previewPath, editorPath } from '../../admin/src/state/content.js';
let f: Awaited<ReturnType<typeof catalogFixture>>;
beforeEach(async()=>{ f=await catalogFixture(); });
function check(collection:'products'|'bundles'|'categories'|'storeSettings', value:unknown, id='new') { return validate(collection,value,{mode:'publish',id,documents:f.docs,resolve:(c,id)=>f.docs.find(d=>d.collection===c&&d.id===id)??null}); }
it('seeds concepts as drafts, singletons published and schema 2',async()=>{ const docs=await loadSeed(); expect(docs.filter(d=>['products','bundles','categories'].includes(d.collection)).every(d=>d.published===undefined&&d.status==='draft')).toBe(true); expect(docs.filter(d=>d.collection==='products')).toHaveLength(10); expect(docs.filter(d=>d.collection==='bundles')).toHaveLength(3); expect(docs.find(d=>d.id==='storeSettings')?.published).toMatchObject({enabled:false}); });
it.each([0,.29,19.99,100])('accepts exact %s',amount=>expect(validateFields({price:{type:'money',exact:true}},{price:{amount}}).valid).toBe(true));
it.each([{amount:-1},{amount:1.001},{amount:1,max:1},{amount:Infinity},{amount:1,currency:'usd'}])('rejects invalid exact money %j',price=>expect(validateFields({price:{type:'money',exact:true}},{price}).valid).toBe(false));
it.each(['CAPS','a--b','a b','-start','end-','x'.repeat(61)])('rejects invalid slug %s',slug=>expect(validateFields({slug:{type:'text',pattern:'slug'}},{slug}).valid).toBe(false));
it('enforces duplicate and reserved slugs within publication',()=>{ expect(check('products',f.product).errors.some(e=>e.path==='slug')).toBe(true); expect(check('products',f.product,'prod_hoodie').valid).toBe(true); expect(check('categories',{name:'X',slug:'cart'}).errors.some(e=>e.path==='slug')).toBe(true); });
it('requires active unique variants, keys and ordered dates',()=>{
 const p=structuredClone(f.product); p.variants=[{...p.variants[0],active:false},{...p.variants[0],active:false}]; p.preorder={opensAt:'2026-01-02T00:00:00Z',closesAt:'2026-01-01T00:00:00Z'};
 const errors=check('products',p,'prod_hoodie').errors; expect(errors.map(e=>e.path)).toEqual(expect.arrayContaining(['variants','variants[1]._key','variants[1].label','preorder.closesAt']));
 expect(validate('products',{name:'Work in progress',variants:[]},{mode:'draft'}).valid).toBe(true);
});
it('rejects unpublished components and missing fixed variants with paths',()=>{
 const p=f.docs.find(d=>d.id==='prod_hoodie')!; p.published=undefined;
 expect(check('bundles',f.bundle,'bundle_coach-kit').errors.map(e=>e.path)).toContain('components[0].productId');
 p.published=p.draft; f.bundle.components[0].fixedVariantKey='unknown';
 expect(check('bundles',f.bundle,'bundle_coach-kit').errors.map(e=>e.path)).toContain('components[0].fixedVariantKey');
});
it('requires contact, payment and active fulfillment before enabling',()=>{
 const s=f.docs.find(d=>d.id==='storeSettings')!.draft as Record<string,unknown>; s.enabled=true;s.contactEmail='';s.offline={enabled:false};
 expect(check('storeSettings',s).errors.map(e=>e.path)).toEqual(expect.arrayContaining(['contactEmail','offline.enabled','pickup.options']));
});
it.each(roles)('gates order actions and settings for %s',role=>{
 const user={id:'test',role,active:true} as User,rank=roles.indexOf(role);
 for(const action of ['orders.view','orders.fulfill','orders.manage','store.manage'] as const) { const expected=rank>=(action==='orders.view'||action==='orders.fulfill'?2:3); expect(can(user,action)).toBe(expected);expect(permissionsFor(user).includes(action)).toBe(expected); }
 expect(can(user,'content.edit',{collection:'storeSettings'})).toBe(rank>=2);
});
it('generates variants without replacing existing keys or duplicate labels',()=>{
 const existing=[{_key:'existing',label:'Youth XS',group:'youth',active:false}],rows=generateVariants(existing,['youth','adult','one-size'],[]);
 expect(rows).toHaveLength(13); expect(rows[0]).toEqual(existing[0]); expect(new Set(rows.map(r=>r._key)).size).toBe(13); expect(rows[1]._key).toMatch(/^[a-f0-9]{8}$/);
 expect(generateVariants(rows,['youth','adult','one-size'],[])).toEqual(rows);
 expect(generateVariants([],['youth'],['Navy','Royal blue'])).toHaveLength(10);
 expect(previewPath('products',{slug:'crest-hoodie'})).toBe('/shop/p/crest-hoodie');expect(editorPath('storeSettings')).toBe('/admin/store/settings');
});
it('registers all twenty image files with real 1200/480 variants and bounded cards',async()=>{
 const {readFile}=await import('node:fs/promises');
 const docs=(await loadSeed()).filter(d=>d.collection==='media'&&d.id.startsWith('media_shop_'));
 expect(docs).toHaveLength(10);
 for(const doc of docs){
   const m=doc.draft as {source:string;width:number;height:number;variants:{web:string;small:string}};
   expect(m).toMatchObject({source:'static',width:1200,height:1200});
   for(const [url,width] of [[m.variants.web,1200],[m.variants.small,480]] as const){
     const b=await readFile('public'+url);expect(b.toString('ascii',8,12)).toBe('WEBP');
     const marker=b.indexOf(Buffer.from([0x9d,0x01,0x2a]));expect(marker).toBeGreaterThan(0);
     expect(b.readUInt16LE(marker+3)&0x3fff).toBe(width);expect(b.readUInt16LE(marker+5)&0x3fff).toBe(width);
     if(width===480)expect(b.length).toBeLessThanOrEqual(50*1024);
   }
 }
});
