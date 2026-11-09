import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VercelBlobs } from '../server/store/blobs/vercel';
import type { Store } from '../server/store/types';
if (!process.env.BLOB_READ_WRITE_TOKEN) console.info('Vercel Blob service tests: not run (no env)');
it.skipIf(!process.env.BLOB_READ_WRITE_TOKEN)('Vercel Blob service: private binary round trip',async()=>{
  const blobs=new VercelBlobs(process.env.BLOB_READ_WRITE_TOKEN!,{listPublishes:async()=>[]} as unknown as Store);
  const path=`media/incoming/contract_${randomBytes(12).toString('hex')}/original.pdf`;
  const bytes=Buffer.from('%PDF-1.7\ncontract\n%%EOF');
  try {
    const result=await blobs.put(path,bytes,{contentType:'application/pdf'});
    const read=await blobs.read(path);expect(read?.contentType).toBe('application/pdf');
    expect(Buffer.from(await new Response(read!.stream).arrayBuffer())).toEqual(bytes);
    expect((await blobs.incoming()).some(item=>item.path===path)).toBe(true);
    await blobs.delete(result.url);
  } finally {await blobs.delete(blobs.url(path));}
},30000);
