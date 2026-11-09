import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsPrimitives } from '../../server/store/primitives/fs';
import { KvStore } from '../../server/store/kv-store';
import { postgresFixture } from '../helpers/postgres';
import { audit } from '../../server/audit';
import { newSession } from '../../server/auth/session';
import { revision } from '../../server/content/revisions';
import type { Store, User, Doc } from '../../server/store/types';
import { scheduleDocuments } from '../../server/content/schedule';
import { buildSnapshot } from '../../server/content/snapshot';
const actor = { id: 'usr_test', displayName: 'Test' }, now = new Date('2030-01-01T12:00:00Z');
const user: User = { id: actor.id, username: 'original', displayName: 'Test', role: 'Owner', passwordHash: 'hash', active: true, createdAt: now.toISOString(), createdBy: 'system' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0)) await fn(); });
async function fixture(driver: string, stage?: string, after = true) {
  let armed = false, writes = 0;
  const inject = (name: string) => { if (armed && name === stage && ++writes === 1) throw new Error('Injected'); };
  let store: Store;
  if (driver === 'postgres') {
    const f = await postgresFixture({ afterWrite: table => inject(table) }); store = f.store; cleanup.push(f.cleanup);
  } else {
    const root = await mkdtemp(join(tmpdir(), 'psc-security-')); cleanup.push(() => rm(root, { recursive:true,force:true }));
    const kv = new FsPrimitives(root), put = kv.put.bind(kv), del = kv.delete.bind(kv);
    kv.put = async (key, value) => { if (!after) inject(key); await put(key,value); if (after) inject(key); };
    kv.delete = async key => { if (!after) inject('delete'); await del(key); if (after) inject('delete'); };
    store = new KvStore(kv, { exclusive: kv.exclusive });
  }
  return { store, arm: () => { armed = true; }, disarm: () => { armed = false; } };
}
if (!process.env.DATABASE_URL) console.info('Security Postgres transactions: not run (no env)');
for (const driver of ['fs','postgres']) describe.skipIf(driver === 'postgres' && !process.env.DATABASE_URL)(`Security transactions (${driver})`, () => {
  for (const stage of driver === 'fs' ? ['audit','delete'] : ['audit','sessions']) for (const after of driver === 'fs' ? [false,true] : [true]) it(`A7: bulk revocation survives failure ${after ? 'after' : 'before'} ${stage}`, async () => {
    const f = await fixture(driver, stage === 'audit' && driver === 'fs' ? undefined : stage, after);
    await f.store.putUser(user);
    const sessions = await Promise.all([newSession(f.store,user,{},now),newSession(f.store,user,{},now)]);
    const entry = audit(actor,'auth.sessions_revoke',{},now);
    // Audit IDs are generated; inject against its exact FS key.
    if (driver === 'fs' && stage === 'audit') {
      const proto = f.store as unknown as {kv: FsPrimitives}; const put = proto.kv.put.bind(proto.kv);
      let once = true;
      vi.spyOn(proto.kv,'put').mockImplementation(async (key,value) => {
        if (key.startsWith('audit/') && once) { once = false; if (after) await put(key,value); throw new Error('Injected'); }
        await put(key,value);
      });
    }
    f.arm(); await expect(f.store.revokeSessions(user.id,entry)).rejects.toThrow('Injected'); f.disarm();
    if (driver === 'fs' && stage === 'delete') {
      for (const {session} of sessions) expect(await f.store.getSession(session.hash)).toBeNull();
      expect(await f.store.listSessions(user.id)).toHaveLength(0);
    }
    await f.store.recoverPublish();
    const remaining = await f.store.listSessions(user.id), audits = (await f.store.queryAudit({action:entry.action,limit:10})).items;
    if (driver === 'fs') { expect(remaining).toHaveLength(0); expect(audits).toEqual([entry]); }
    else { expect(remaining).toHaveLength(sessions.length); expect(audits).toHaveLength(0); await f.store.revokeSessions(user.id,entry); }
    expect(await f.store.listSessions(user.id)).toHaveLength(0);
  });
  for (const stage of driver === 'fs' ? ['users/usr_test.json','users-by-name/renamed.json','delete'] : ['users']) it(`F-L1: rename remains recoverable across ${stage} failure`, async () => {
    const f = await fixture(driver,stage); await f.store.putUser(user); f.arm();
    await expect(f.store.putUser({...user,username:'renamed'})).rejects.toThrow('Injected'); f.disarm();
    await f.store.recoverPublish();
    if (driver === 'postgres') { expect((await f.store.getUser(user.id))?.username).toBe('original'); await f.store.putUser({...user,username:'renamed'}); }
    expect(await f.store.getUserByUsername('original')).toBeNull();
    expect((await f.store.getUserByUsername('renamed'))?.id).toBe(user.id);
  });
  it('F-H2: paginates audit without reading a full month and rejects invalid cursors', async () => {
    const f = await fixture(driver);
    for (let i=0;i<40;i++) await f.store.recordAudit(audit(actor,'test',{},new Date(now.getTime()+i)));
    const spy = driver === 'fs' ? vi.spyOn((f.store as unknown as {kv:FsPrimitives}).kv,'get') : null;
    const page = await f.store.queryAudit({limit:2}); expect(page.items).toHaveLength(2);
    if (spy) expect(spy.mock.calls.filter(([key])=>key.startsWith('audit/')).length).toBeLessThanOrEqual(3);
    const next = await f.store.queryAudit({limit:2,cursor:page.cursor}); expect(next.items[0].at < page.items[1].at).toBe(true);
    await expect(f.store.queryAudit({limit:2,cursor:'garbage'})).rejects.toMatchObject({status:422});
  });

  it('A5: concurrent scheduling and dependency trash cannot commit a broken schedule', async () => {
    const f = await fixture(driver);
    const base = {version:1,status:'draft' as const,createdAt:now.toISOString(),updatedAt:now.toISOString(),createdBy:actor.id,updatedBy:actor.id};
    const tier:Doc = {...base,id:'tier_race',collection:'sponsorTiers',draft:{name:'Tier'}};
    const sponsor:Doc = {...base,id:'spon_race',collection:'sponsors',draft:{name:'Sponsor',tier:tier.id}};
    for (const doc of [tier,sponsor]) await f.store.createDoc({doc,revision:revision(doc,actor,'created',now),audit:audit(actor,'create',{},now)});
    const results = await Promise.allSettled([
      scheduleDocuments(f.store,[{collection:sponsor.collection,id:sponsor.id,expectedVersion:1}],'2030-01-03T12:00:00Z',actor,now),
      f.store.mutateDoc({collection:tier.collection,id:tier.id,expectedVersion:1,patch:{status:'trashed',trashedAt:now.toISOString()},audit:audit(actor,'trash',{},now)}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const scheduled = (await f.store.getSnapshot())?.scheduled.length ?? 0;
    expect(scheduled && (await f.store.getDoc(tier.collection,tier.id))?.trashedAt).toBeFalsy();
  });
  it('A3/F-M3: rejects unversioned envelope changes and invalid identifiers before writing', async () => {
    const f = await fixture(driver), doc:Doc = {id:'evt_test',collection:'events',version:1,draft:{title:'Test',date:'2030-01-03'},status:'draft',createdAt:now.toISOString(),updatedAt:now.toISOString(),createdBy:actor.id,updatedBy:actor.id};
    await f.store.createDoc({doc,revision:revision(doc,actor,'created',now),audit:audit(actor,'created',{},now)});
    const next={...doc,published:doc.draft,publishedVersion:1,status:'published' as const}; const rev=revision(next,actor,'published',now);
    await expect(f.store.publish({docs:[{expectedVersion:1,nextDoc:next}],revisions:[rev],snapshot:buildSnapshot([next],{siteVersion:1,publishedAt:now.toISOString(),templateHash:''}),record:{siteVersion:1,at:now.toISOString(),actorId:actor.id,kind:'publish',manifest:[{collection:doc.collection,id:doc.id,version:1,order:0,title:'Test',revId:rev.id}]}})).rejects.toThrow('version');
    await expect(f.store.getDoc('events','a'.repeat(201))).rejects.toMatchObject({status:422});
    await expect(f.store.getDoc('events','invalid.id')).rejects.toMatchObject({status:422});
    expect(await f.store.getSnapshot()).toBeNull();
  });
});
