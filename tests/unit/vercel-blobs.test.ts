import { afterEach, describe, expect, it, vi } from 'vitest';
const sdk=vi.hoisted(()=>({put:vi.fn(),get:vi.fn(),del:vi.fn(),list:vi.fn(),handleUpload:vi.fn()}));
vi.mock('@vercel/blob',()=>sdk);vi.mock('@vercel/blob/client',()=>sdk);
import { VercelBlobs } from '../../server/store/blobs/vercel.js';
import type { Store } from '../../server/store/types.js';
const store={listPublishes:async()=>[]} as unknown as Store;
afterEach(()=>vi.resetAllMocks());
describe('Vercel private binary adapter',()=>{
  it('uses private, immutable uploads and returns an application delivery URL',async()=>{
    const blobs=new VercelBlobs('server-token',store);
    sdk.put.mockResolvedValue({url:'https://private.invalid/object'});
    expect(await blobs.put('media/2030/media_a/original.png',new Uint8Array([1]),{contentType:'image/png'})).toEqual({url:'/media/media/2030/media_a/original.png'});
    expect(sdk.put).toHaveBeenCalledWith('media/2030/media_a/original.png',expect.any(Buffer),expect.objectContaining({access:'private',allowOverwrite:false,addRandomSuffix:false,token:'server-token'}));
    await expect(blobs.put('../escape',new Uint8Array(),{contentType:'image/png'})).rejects.toThrow();
    await expect(blobs.put('media/2030/media_a/original.png',new Uint8Array(),{contentType:'image/svg+xml'})).rejects.toThrow();
  });
  it('fetches private bytes from the canonical path and deletes only incoming files',async()=>{
    const blobs=new VercelBlobs('server-token',store);
    sdk.get.mockResolvedValue({statusCode:200,stream:new ReadableStream(),blob:{size:5,contentType:'image/png'}});
    expect((await blobs.read('media/incoming/abc/original.png'))?.size).toBe(5);
    expect(sdk.get).toHaveBeenCalledWith('media/incoming/abc/original.png',{access:'private',token:'server-token',useCache:false});
    await blobs.delete('/media/media/incoming/abc/original.png');expect(sdk.del).toHaveBeenCalledWith('media/incoming/abc/original.png',{token:'server-token'});
    await expect(blobs.delete('/media/media/2030/media_a/original.png')).rejects.toThrow('cannot be deleted');
    await expect(blobs.delete('https://evil.example/object')).rejects.toThrow();
  });
  it('restricts client tokens to the ticket path, MIME, expiry and size, and delegates signed callbacks',async()=>{
    const blobs=new VercelBlobs('server-token',store), request=new Request('https://example.com/api/admin/media/upload-url');
    sdk.handleUpload.mockImplementation(async options=>{
      expect(options.token).toBe('server-token');
      expect(await options.onBeforeGenerateToken('media/incoming/abc/original.png')).toEqual({allowedContentTypes:['image/png'],maximumSizeInBytes:50,validUntil:10000,addRandomSuffix:false,allowOverwrite:false,callbackUrl:'https://example.com/api/admin/cron/blob-upload'});
      await expect(options.onBeforeGenerateToken('media/2030/abc/original.png')).rejects.toThrow();
      return {type:'blob.generate-client-token',clientToken:'scoped-token'};
    });
    expect(await blobs.clientUpload(request,{}, {path:'media/incoming/abc/original.png',mime:'image/png',size:50,expires:10000})).toHaveProperty('clientToken','scoped-token');
    sdk.handleUpload.mockRejectedValue(new Error('Invalid signature'));
    await expect(blobs.clientUpload(request,{type:'blob.upload-completed'})).rejects.toThrow('signature');
  });
});
