import { adminPassword } from './credentials.js';
import { expect, test } from './fixtures.js';
// Phase 6 exercises storage over real HTTP; the dropzone/editor is Phase 10.
test('quarantines an upload, verifies it and serves only finalized media',async({context})=>{
  const api=context.request;
  const login=await api.post('/api/admin/auth/login',{data:{username:'Phil',password:adminPassword}});
  expect(login.ok()).toBeTruthy();
  const headers={'X-CSRF-Token':(await login.json()).csrfToken,Origin:'http://localhost:3000'};
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII=','base64');
  const issued=await api.post('/api/admin/media/upload-url',{headers,data:{filename:'crest.png',mime:'image/png',size:bytes.length}});
  expect(issued.ok()).toBeTruthy();const grant=await issued.json();expect(grant.local).toBe(true);
  expect((await api.put(grant.uploadUrl,{headers:{...headers,'Content-Type':'image/png'},data:bytes})).ok()).toBeTruthy();
  expect((await api.get('/blobs/'+grant.pathname)).status()).toBe(404);
  const finalized=await api.post('/api/admin/media',{headers,data:{ticket:grant.ticket,alt:'Uploaded crest',width:99999}});
  expect(finalized.status()).toBe(201);const doc=(await finalized.json()).doc;
  expect(doc.draft.width).toBe(1);expect(doc.draft.height).toBe(1);
  const file=await api.get(doc.draft.variants.original);expect(file.ok()).toBeTruthy();expect(file.headers()['content-type']).toBe('image/png');
  expect(await file.body()).toEqual(bytes);
  const published=await api.post('/api/admin/publish',{headers,data:{items:[{collection:'media',id:doc.id,expectedVersion:doc.version}]}});
  expect(published.ok()).toBeTruthy();
  await api.post('/api/admin/auth/logout',{headers});
  expect((await api.get(doc.draft.variants.original)).ok()).toBeTruthy();
});
