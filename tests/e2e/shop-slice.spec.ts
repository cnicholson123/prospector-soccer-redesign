import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, restoreSeed } from './fixtures.js';
import { adminPassword } from './credentials.js';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Phase 2 slice stops at checkout. Real orders/payment/pickup extend this in Phases 3–4.
async function enableCatalog(request: APIRequestContext) {
  const login=await request.post('/api/admin/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:'Phil',password:adminPassword}});expect(login.ok()).toBeTruthy();
  const {csrfToken}=await login.json(),headers={'X-CSRF-Token':csrfToken,Origin:'http://localhost:3000'};
  const items=[];
  for(const collection of ['categories','products','bundles','faqs']){
    const response=await request.get('/api/admin/docs/'+collection);expect(response.ok()).toBeTruthy();const {docs}=await response.json();
    items.push(...docs.filter((d:{draft:{page?:string}})=>collection!=='faqs'||d.draft.page==='shop').map((d:{id:string;version:number})=>({collection,id:d.id,expectedVersion:d.version})));
  }
  const response=await request.get('/api/admin/docs/storeSettings/storeSettings'),{doc}=await response.json();
  const saved=await request.put('/api/admin/docs/storeSettings/storeSettings',{headers,data:{baseVersion:doc.version,draft:{...doc.draft,enabled:true,pickup:{enabled:true,options:[{_key:'testpick',label:'Saturday practice',details:'Cameron Park',active:true}]}}}});expect(saved.ok()).toBeTruthy();
  const next=(await saved.json()).doc;items.push({collection:'storeSettings',id:'storeSettings',expectedVersion:next.version});
  const published=await request.post('/api/admin/publish',{headers,data:{items,summary:'Storefront browser test'}});expect(published.ok()).toBeTruthy();
}
test.afterEach(async({context})=>{
  await restoreSeed(context);
  const directory=process.env.PSC_E2E_DATA_DIR;
  if(!directory||!resolve(directory).startsWith(resolve('.cache')+sep+'e2e-'))throw new Error('Expected isolated shop fixture');
  await rm(join(directory,'shop'),{recursive:true,force:true});
});
async function keyboardActivate(page:Page,target:Locator){
  await expect(target).toBeVisible();
  for(let i=0;i<150;i++){if(await target.evaluate(el=>el===document.activeElement)){await page.keyboard.press('Enter');return;}await page.keyboard.press('Tab');}
  throw new Error('Control not reachable by keyboard');
}
for(const width of [390,820,1280])test(`catalog to cart and checkout ${width}px`,async({page,context},info)=>{
  test.setTimeout(90000);await enableCatalog(context.request);await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');expect(await page.getByRole('link',{name:'Shop',exact:true}).count()).toBeGreaterThan(0);
  await page.goto('/shop');await expect(page.getByRole('heading',{name:/Wear the gold/})).toBeVisible();
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Crest Hoodie',exact:true})}).click();
  await page.getByRole('radio',{name:'Youth M',exact:true}).check();await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'Your club gear'});await expect(drawer).toBeVisible();await expect(drawer).toContainText('Youth M');await drawer.getByRole('button',{name:'Close cart'}).click();
  await page.getByRole('radio',{name:'Adult L',exact:true}).check();await page.getByLabel('Quantity',{exact:true}).fill('2');await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await expect(drawer).toContainText('Adult L');await drawer.getByRole('link',{name:'View cart',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your cart',exact:true})).toBeVisible();await expect(page.locator('main [data-cart-total]')).toHaveText('$145.00');
  await page.reload();await expect(page.locator('main [data-cart-total]')).toHaveText('$145.00');
  await page.getByRole('link',{name:'Continue to checkout'}).click();await expect(page.getByRole('heading',{name:'Checkout',exact:true})).toBeVisible();
  await page.getByLabel('Full name',{exact:true}).fill('Store Test');await page.getByLabel('Email',{exact:true}).fill('store@example.test');
  await page.getByRole('button',{name:'Place order'}).click();await expect(page.locator('[data-checkout-errors]')).toContainText('Ordering is not open yet');
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath(`checkout-${width}.png`),fullPage:true});
});
test('keyboard-only product, drawer focus and cart navigation',async({page,context})=>{
  await enableCatalog(context.request);await page.setViewportSize({width:1280,height:900});await page.goto('/shop/p/crest-hoodie');
  await keyboardActivate(page,page.getByRole('button',{name:'Add to cart',exact:true}));await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('button',{name:'Add to cart',exact:true})).toBeFocused();
  await keyboardActivate(page,page.getByRole('link',{name:'Open cart'}));await keyboardActivate(page,page.getByRole('dialog').getByRole('link',{name:'View cart'}));
  await keyboardActivate(page,page.getByRole('link',{name:'Continue to checkout'}));await expect(page.getByRole('heading',{name:'Checkout',exact:true})).toBeVisible();
});
test('preview stays private and cart recovers from a changed quote',async({page,context})=>{
  await enableCatalog(context.request);await page.goto('/shop/p/crest-hoodie');await page.getByRole('button',{name:'Add to cart',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Checkout',exact:true}).click();
  await page.getByLabel('Full name',{exact:true}).fill('Cart Test');await page.getByLabel('Email',{exact:true}).fill('cart@example.test');
  await page.route('**/api/shop/checkout',async route=>{
    const request=route.request().postDataJSON();const quote=await context.request.post('/api/shop/quote',{headers:{Origin:'http://localhost:3000'},data:{lines:request.lines}});
    const updated=await quote.json();updated.problems=[{code:'qty_capped',line:0,message:'Please review the updated cart.'}];
    await route.fulfill({status:409,json:{error:{code:'cart_changed'},quote:updated}});
  });
  await page.getByRole('button',{name:'Place order'}).click();await expect(page.locator('[data-checkout-errors]')).toContainText('Your cart changed');await expect(page.getByRole('button',{name:'Place order'})).toBeEnabled();
});
test('catalog editor adds variants and retains stable existing identities',async({page,context})=>{
  await enableCatalog(context.request);
  const before=await context.request.get('/api/admin/docs/products/prod_hoodie');const original=(await before.json()).doc.draft.variants;
  await page.goto('/admin/products/prod_hoodie');await expect(page.getByRole('heading',{name:'Crest Hoodie',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Generate variants',exact:true}).click();
  await expect.poll(async()=>{const r=await context.request.get('/api/admin/docs/products/prod_hoodie');return (await r.json()).doc.draft.variants.length;}).toBe(12);
  const after=await context.request.get('/api/admin/docs/products/prod_hoodie');const rows=(await after.json()).doc.draft.variants;
  expect(rows.slice(0,original.length)).toEqual(original);expect(rows.some((v:{label:string})=>v.label==='Adult XS')).toBe(true);
});
