import { adminPassword } from './credentials.js';
import { test, expect } from './fixtures.js';
// Run with installed Chrome outside the Codex sandbox, like the Phase 6 specs.
test('security remediation: default auth, bounded input, tokens, audit and retained creation history', async ({ request }) => {
  expect((await request.get('/api/admin/future-admin-route')).status()).toBe(401);
  const login = await request.post('/api/admin/auth/login', {data:{username:'Phil',password:adminPassword}});
  expect(login.status()).toBe(200);
  const {csrfToken} = await login.json();
  const headers = {'X-CSRF-Token':csrfToken, Origin:'http://localhost:3000'};
  expect((await request.post('/api/admin/auth/logout',{headers:{...headers,'X-CSRF-Token':'é'.repeat(csrfToken.length)}})).status()).toBe(403);
  expect((await request.get('/api/admin/audit?cursor=garbage')).status()).toBe(422);
  expect((await request.get('/api/admin/docs/events/'+'x'.repeat(201))).status()).toBe(422);
  const created = await request.post('/api/admin/docs/events',{headers,data:{draft:{title:'Security A',date:'2030-01-03'}}}); expect(created.status()).toBe(201);
  const {doc} = await created.json(), path = `/api/admin/docs/events/${doc.id}`;
  const changed = await request.put(path,{headers,data:{baseVersion:doc.version,draft:{...doc.draft,title:'Security B'}}}); expect(changed.status()).toBe(200);
  const {revisions} = await (await request.get(`/api/admin/revisions/events/${doc.id}`)).json();
  expect(revisions).toHaveLength(2); expect(revisions.find((r:{action:string})=>r.action==='created').data.title).toBe('Security A');
  const published = await request.post('/api/admin/publish',{headers,data:{items:[{collection:'events',id:doc.id,expectedVersion:(await changed.json()).doc.version}]}}); expect(published.status()).toBe(200);
  const current = (await (await request.get(path)).json()).doc;
  expect(current.version).toBe(doc.version+2);
  await request.post(path+'/trash',{headers,data:{baseVersion:current.version}});
  expect((await request.post('/api/admin/rebuild',{headers,data:{}})).status()).toBe(200);
  expect(await (await request.get('/')).text()).toContain('Security B');
  await request.post('/api/admin/unpublish',{headers,data:{items:[{collection:'events',id:doc.id,expectedVersion:current.version+1}]}});
  expect(await (await request.get('/')).text()).not.toContain('Security B');
});
