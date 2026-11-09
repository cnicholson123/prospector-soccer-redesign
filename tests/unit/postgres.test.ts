import { describe, expect, it } from 'vitest';
import { postgresFixture } from '../helpers/postgres';
import { migrate } from '../../scripts/db-migrate';
import { createHistoryId } from '../../server/content/ids';
import { buildSnapshot } from '../../server/content/snapshot';
import type { AuditEntry, Doc, Revision, PublishTx } from '../../server/store/types';
const at='2030-01-01T00:00:00.000Z';
const doc:Doc={id:'evt_atomic',collection:'events',draft:{title:'Original',date:'2030-01-03'},version:1,status:'draft',order:0,createdAt:at,updatedAt:at,createdBy:'owner',updatedBy:'owner'};
const audit=():AuditEntry=>({id:createHistoryId('aud',new Date(at)),at,actorId:'owner',actorName:'Owner',action:'test'});
const revision=(d:Doc):Revision=>({id:createHistoryId('rev',new Date(at)),at,collection:'events',docId:d.id,docVersion:d.version,data:d.draft,authorId:'owner',authorName:'Owner',action:'edited'});
if (!process.env.DATABASE_URL) console.info('Postgres transaction tests: not run (no env)');
describe.skipIf(!process.env.DATABASE_URL)('Postgres transactions',()=>{
  it('applies migration repeatedly, enforces IDs and sealed history in SQL',async()=>{
    const f=await postgresFixture();try {
      await migrate(f.pool);await migrate(f.pool);
      expect((await f.pool.query('SELECT count(*) AS count FROM schema_migrations')).rows[0].count).toBe('1');
      const rev={...revision(doc),sealedAt:at};await f.store.createDoc({doc,revision:rev,audit:audit()});
      await expect(f.pool.query("UPDATE revisions SET body=jsonb_set(body,'{data}', '\"changed\"') WHERE id=$1",[rev.id])).rejects.toThrow('sealed');
      await expect(f.pool.query('DELETE FROM revisions WHERE id=$1',[rev.id])).rejects.toThrow('retained');
      await expect(f.store.createDoc({doc:{...doc,collection:'teams'},revision:{...revision(doc),collection:'teams'},audit:audit()})).rejects.toThrow('exists');
    } finally {await f.cleanup();}
  });
  for(const stage of ['revisions','audit','docs']) it(`rolls back a mutation failure after ${stage}`,async()=>{
    let armed=false;const f=await postgresFixture({afterWrite:table=>{if(armed&&table===stage)throw new Error('Injected');}});
    try {
      const original=revision(doc);await f.store.createDoc({doc,revision:original,audit:audit()});armed=true;
      const next={...doc,version:2,draft:{title:'Updated',date:'2030-01-03'}};
      await expect(f.store.mutateDoc({collection:'events',id:doc.id,expectedVersion:1,patch:{draft:next.draft},seal:[original.id],revision:{append:revision(next)},audit:audit()})).rejects.toThrow('Injected');
      expect(await f.reopen().getDoc('events',doc.id)).toEqual(doc);
      expect(await f.store.getRevision(doc.id,original.id)).toEqual(original);
      expect(await f.store.listRevisions('events',doc.id,100)).toHaveLength(1);
      expect((await f.store.queryAudit({limit:100})).items).toHaveLength(1);
    } finally {await f.cleanup();}
  });
  for(const stage of ['docs','revisions','audit','publishes','snapshots']) it(`rolls back a publish failure after ${stage}, then safely retries`,async()=>{
    let armed=false;const f=await postgresFixture({afterWrite:table=>{if(armed&&table===stage)throw new Error('Injected');}});
    try {
      await f.store.createDoc({doc,revision:revision(doc),audit:audit()});
      const next={...doc,version:2,published:doc.draft,publishedVersion:2,status:'published' as const},rev={...revision(next),sealedAt:at};
      const tx:PublishTx={docs:[{expectedVersion:1,nextDoc:next}],revisions:[rev],audit:[audit()],record:{siteVersion:1,at,actorId:'owner',kind:'publish',manifest:[{collection:'events',id:doc.id,version:2,order:0,title:'Original',revId:rev.id}]},snapshot:buildSnapshot([next],{siteVersion:1,publishedAt:at,templateHash:'test'})};
      armed=true;await expect(f.store.publish(tx)).rejects.toThrow('Injected');
      expect(await f.reopen().getDoc('events',doc.id)).toEqual(doc);expect(await f.store.getSnapshot()).toBeNull();expect(await f.store.getPublish(1)).toBeNull();
      expect(await f.store.recoverPublish()).toEqual({repaired:false,siteVersion:0});
      armed=false;await f.store.publish(tx);await f.reopen().publish(tx);
      expect(await f.store.getSnapshot()).toEqual(tx.snapshot);expect(await f.store.listPublishes(100)).toHaveLength(1);
    } finally {await f.cleanup();}
  });
});
