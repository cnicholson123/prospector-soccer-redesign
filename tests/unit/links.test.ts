import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { checkLink, checkLinks } from '../../server/content/links.js';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
type Reply = { status: number; location?: string; bytes?: number; length?: number; hang?: boolean };
function transport(replies: Reply[]) {
  const methods: string[] = [];
  const fake = vi.fn((...args: unknown[]) => {
    const opts = args[1] as { method: string; signal: AbortSignal; lookup: (host: string, opts: object, callback: (e: unknown, address: string, family: number) => void) => void };
    const callback = args[2] as (res: http.IncomingMessage) => void;
    methods.push(opts.method);
    opts.lookup('public.example', {}, (_e, address) => expect(address).toBe('93.184.216.34'));
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const reply = replies.shift()!;
      if (reply.hang) return;
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy: (err?: Error) => void };
      res.statusCode = reply.status; res.headers = { location: reply.location, 'content-length': reply.length };
      res.destroy = err => { if (err) queueMicrotask(() => res.emit('error', err)); };
      callback(res as unknown as http.IncomingMessage);
      queueMicrotask(() => { if (reply.bytes) res.emit('data', Buffer.alloc(reply.bytes)); res.emit('end'); });
    };
    return req as unknown as http.ClientRequest;
  });
  vi.spyOn(http, 'request').mockImplementation(fake as unknown as typeof http.request);
  vi.spyOn(https, 'request').mockImplementation(fake as unknown as typeof https.request);
  return { fake, methods };
}
it('pins DNS and rechecks each redirect, refusing private destinations', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  const { fake } = transport([{ status: 302, location: 'http://169.254.169.254/latest/meta-data' }]);
  expect((await checkLink('https://public.example')).ok).toBe(false); expect(fake).toHaveBeenCalledTimes(1);
});
it('refuses a hostname with even one private DNS answer', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] as never);
  const { fake } = transport([]); expect((await checkLink('https://public.example')).ok).toBe(false); expect(fake).not.toHaveBeenCalled();
});
it('falls back from HEAD to GET and accepts a public response', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  const { methods } = transport([{ status: 405 }, { status: 200, bytes: 128 }]);
  expect(await checkLink('https://public.example')).toMatchObject({ ok: true, status: 200 }); expect(methods).toEqual(['HEAD', 'GET']);
});
it('caps redirects at three', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  const { fake } = transport(Array.from({ length: 4 }, () => ({ status: 302, location: '/again' })));
  expect(await checkLink('https://public.example')).toMatchObject({ ok: false, error: 'Too many redirects' }); expect(fake).toHaveBeenCalledTimes(4);
});
it('caps declared and streamed response sizes at 1 MB', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  for (const reply of [{ status: 200, length: 1024 * 1024 + 1 }, { status: 200, bytes: 1024 * 1024 + 1 }]) {
    transport([reply]); expect((await checkLink('https://public.example')).ok).toBe(false);
  }
});
it('times out the complete operation after eight seconds', async () => {
  vi.useFakeTimers(); vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  transport([{ status: 200, hang: true }]); const result = checkLink('https://public.example');
  await vi.advanceTimersByTimeAsync(8000); expect(await result).toMatchObject({ ok: false, error: 'Link check timed out' });
});

it('limits link-check workers to five concurrent lookups', async () => {
  let active = 0, maximum = 0;
  vi.mocked(lookup).mockImplementation((async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return [{ address: '93.184.216.34', family: 4 }];
  }) as unknown as typeof lookup);
  transport(Array.from({ length: 12 }, () => ({ status: 200 })));
  expect(await checkLinks(Array.from({ length: 12 }, (_, i) => `https://public.example/${i}`))).toHaveLength(12);
  expect(maximum).toBe(5);
});
