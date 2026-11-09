import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm, readFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { adminFixture, createUserWithPassword } from '../helpers/admin.js';
import { createMediaBlobs } from '../../server/store/index.js';
import { collectIncoming, readGrant, serveMedia, uploadGrant, verifyMedia } from '../../server/media.js';
import { loadConfig } from '../../server/config.js';
const roots: string[]=[];
afterEach(async()=>{ vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true}))); });
// Real one-pixel PNG.
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII=','base64');
async function fixture() { const f=await adminFixture(); roots.push(f.root); await f.login(); return f; }
async function grant(f: Awaited<ReturnType<typeof fixture>>, mime='image/png', size=png.length) {
  const response=await f.req('/media/upload-url','POST',{filename:'../../club.png',mime,size});
  expect(response.status).toBe(200); const result = await response.json();
  if (mime !== 'application/pdf') {
    const web = await (await f.req('/media/upload-url', 'POST', { filename: 'web.webp', mime: 'image/webp', size: webp.length })).json();
    await upload(f, web.ticket, webp, 'image/webp'); result.webTicket = web.ticket;
  }
  return result;
}
async function upload(f:Awaited<ReturnType<typeof fixture>>, ticket:string, bytes:Buffer=png,mime='image/png') {
  const {path}=readGrant(ticket,(await f.store.listUsers())[0].id,f.config,new Date('2030-01-01T12:00:00Z'));
  await createMediaBlobs(f.config,f.store).put(path,bytes,{contentType:mime}); return path;
}
describe('private media quarantine',()=>{
  it('requires auth and upload permission; rejects SVG, size excess, and generic media creation',async()=>{
    const f=await adminFixture();roots.push(f.root);
    expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:10})).status).toBe(401);
    await f.login();
    expect((await f.req('/media/upload-url','POST',{filename:'x.svg',mime:'image/svg+xml',size:10})).status).toBe(422);
    expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:9*1024*1024})).status).toBe(422);
    expect((await f.req('/docs/media','POST',{draft:{}})).status).toBe(403);
    await createUserWithPassword(f, {username:'viewer',password:'My fieldside viewer phrase',role:'Viewer'});await f.login('viewer','My fieldside viewer phrase');
    expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:10})).status).toBe(403);
  });
  it('signs owner-bound expiring tickets; detects tampering',()=>{
    const config=loadConfig({SESSION_SECRET:'x'.repeat(32)},()=>{}),now=new Date();
    const {ticket,grant}=uploadGrant({filename:'../../club.png',mime:'image/png',size:png.length},'owner',config,now);
    expect(grant.filename).toBe('club.png');expect(readGrant(ticket,'owner',config,now)).toEqual(grant);
    expect(()=>readGrant(ticket,'other',config,now)).toThrow();
    expect(()=>readGrant(ticket+'a','owner',config,now)).toThrow();
    expect(()=>readGrant(ticket,'owner',config,new Date(now.getTime()+900000))).toThrow();
  });
  it('validates magic bytes, dimensions, declared size and does not trust submitted URLs',async()=>{
    const f=await fixture();const g=await grant(f); const path=await upload(f,g.ticket);
    expect(await f.store.listDocs('media')).toHaveLength(0);
    const response=await f.req('/media','POST',{ticket:g.ticket,webTicket:g.webTicket,url:'http://127.0.0.1/secret',width:999,height:999,alt:'Club crest'});
    expect(response.status).toBe(201);const doc=(await response.json()).doc;
    expect(doc.draft).toMatchObject({width:1,height:1,filename:'club.png',alt:'Club crest',mime:'image/png'});
    expect(doc.draft.variants.original).toMatch(/^\/blobs\/media\/2030\/media_/);
    expect(await createMediaBlobs(f.config,f.store).read(path)).toBeNull();
    expect((await f.req('/media','POST',{ticket:g.ticket,webTicket:g.webTicket,alt:'Club crest'})).status).toBe(201);
    expect(await f.store.listDocs('media')).toHaveLength(1);
    expect((await f.store.queryAudit({action:'media.upload',limit:10})).items).toHaveLength(1);
    const blobs=createMediaBlobs(f.config,f.store);
    expect((await serveMedia(new Request('http://localhost:3000'+doc.draft.variants.original),f.store,blobs)).status).toBe(404);
    expect((await serveMedia(new Request('http://localhost:3000'+doc.draft.variants.original,{headers:{cookie:f.getCookie()}}),f.store,blobs)).status).toBe(200);
    expect((await serveMedia(new Request('http://localhost:3000/blobs/'+path,{headers:{cookie:f.getCookie()}}),f.store,blobs)).status).toBe(404);
  });
  it('uploads through the authenticated binary route, publishes a verified file and retains its history',async()=>{
    const f=await fixture(),g=await grant(f),login=await f.login();
    const result=await f.app.request(g.uploadUrl,{method:'PUT',headers:{cookie:f.getCookie(),'X-CSRF-Token':login.data.csrfToken,Origin:f.config.publicBaseUrl,'Content-Type':'image/png'},body:png});
    expect(result.status).toBe(200);
    const repeated=await f.app.request(g.uploadUrl,{method:'PUT',headers:{cookie:f.getCookie(),'X-CSRF-Token':login.data.csrfToken,Origin:f.config.publicBaseUrl,'Content-Type':'image/png'},body:png});
    expect(repeated.status).toBe(409);
    const finalized=await f.req('/media','POST',{ticket:g.ticket,webTicket:g.webTicket});expect(finalized.status).toBe(201);const doc=(await finalized.json()).doc;
    const response=await f.req('/publish','POST',{items:[{collection:'media',id:doc.id,expectedVersion:doc.version}]});expect(response.status).toBe(200);
    const blobs=createMediaBlobs(f.config,f.store), file=await serveMedia(new Request('http://localhost:3000'+doc.draft.variants.original),f.store,blobs);
    expect(file.status).toBe(200);expect(file.headers.get('cache-control')).toContain('public');expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
    await expect(blobs.delete(doc.draft.variants.original)).rejects.toThrow('retained');
    expect((await f.req('/media/'+doc.id,'PATCH',{baseVersion:1,variants:{original:'https://evil.example'}})).status).toBe(422);
  });
  it('refuses disguised SVG, MIME mismatch, invalid dimensions and missing quarantine objects',async()=>{
    const f=await fixture(), g=await grant(f);
    expect((await f.req('/media','POST',{ticket:g.ticket,webTicket:g.webTicket})).status).toBe(422);
    const evil=Buffer.from('<svg onload="alert(1)"></svg>');const bad=await grant(f,'image/png',evil.length);await upload(f,bad.ticket,evil);
    expect((await f.req('/media','POST',{ticket:bad.ticket,webTicket:bad.webTicket})).status).toBe(422);expect(await f.store.listDocs('media')).toHaveLength(0);
    expect(()=>verifyMedia(png,'image/jpeg')).toThrow('signature');
    const huge=Buffer.from(png);huge.writeUInt32BE(100000,16);expect(()=>verifyMedia(huge,'image/png')).toThrow('dimensions');
    const truncated=Buffer.from([255,216,255]);expect(()=>verifyMedia(truncated,'image/jpeg')).toThrow();
  });
  it('accepts PDFs without invented dimensions and cleans only old incoming files',async()=>{
    const f=await fixture(),pdf=Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const g=await grant(f,'application/pdf',pdf.length);await upload(f,g.ticket,pdf,'application/pdf');
    const response=await f.req('/media','POST',{ticket:g.ticket,webTicket:g.webTicket});expect(response.status).toBe(201);const doc=(await response.json()).doc;
    expect(doc.draft.width).toBeUndefined();
    const old=await grant(f);const path=await upload(f,old.ticket);await utimes(join(f.root,'blobs',path),new Date('2029-01-01'),new Date('2029-01-01'));
    const blobs=createMediaBlobs(f.config,f.store);
    expect(await collectIncoming(blobs,new Date('2030-01-01'))).toBe(2);
    const bytes=await readFile(join(f.root,'blobs',doc.draft.variants.original.slice(7)));expect(bytes).toEqual(pdf);
  });
  it('rejects missing CSRF and rate-limits grant issuance',async()=>{
    const f=await fixture();
    expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:1},{'X-CSRF-Token':'wrong'})).status).toBe(403);
    for(let i=0;i<60;i++) expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:1})).status).toBe(200);
    expect((await f.req('/media/upload-url','POST',{filename:'x.png',mime:'image/png',size:1})).status).toBe(429);
  });
});
