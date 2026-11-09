import { renderPublic } from '../server/render/handler.js';
import { createStore, createMediaBlobs } from '../server/store/index.js';
import { loadConfig } from '../server/config.js';
import { serveMedia } from '../server/media.js';
import type { Store, MediaStorage } from '../server/store/types.js';
let mediaStore: Store | undefined, blobs: MediaStorage | undefined;
export default { fetch: (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/media/') || url.searchParams.has('media')) {
    const config=loadConfig(); mediaStore ??= createStore(config); blobs ??= createMediaBlobs(config,mediaStore);
    if (url.searchParams.has('media')) { url.pathname='/media/'+url.searchParams.get('media'); request=new Request(url,request); }
    return serveMedia(request,mediaStore,blobs);
  }
  return renderPublic(request);
} };
