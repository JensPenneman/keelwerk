import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { compressResponse } from '../src/compress-response.ts';

const big = JSON.stringify({
  rows: Array.from({ length: 200 }, (_, index) => ({ index, name: `row ${index}` })),
});
const request = (encoding?: string, method = 'GET'): Request =>
  new Request('https://a.example.test/x', {
    method,
    ...(encoding === undefined ? {} : { headers: { 'accept-encoding': encoding } }),
  });
const json = (body: string, init: ResponseInit = {}, type = 'application/json'): Response =>
  new Response(body, { ...init, headers: { 'content-type': type, ...init.headers } });

describe('compressResponse', () => {
  test('vary gains accept-encoding once, and not after vary *', async () => {
    const twice = await compressResponse(
      json(big, { headers: { vary: 'Accept-Encoding' } }),
      request('br'),
    );
    expect(twice.headers.get('vary')).toBe('Accept-Encoding');
    const star = await compressResponse(json(big, { headers: { vary: '*' } }), request('br'));
    expect(star.headers.get('vary')).toBe('*');
    const other = await compressResponse(json(big, { headers: { vary: 'origin' } }), request('br'));
    expect(other.headers.get('vary')).toBe('origin, accept-encoding');
  });

  test('a source body that fails in its first KiB fails the body, not compressResponse', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.error(new Error('source failed'));
      },
    });
    const response = await compressResponse(
      new Response(source, { headers: { 'content-type': 'application/json' } }),
      request('br'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.has('content-encoding')).toBe(false);
    await expect(response.arrayBuffer()).rejects.toThrow('source failed');
  });

  test('a JSON body over 1 KiB is brotli for accept-encoding br and gzip for gzip', async () => {
    const brotli = await compressResponse(
      json(big, { headers: { 'content-length': `${big.length}` } }),
      request('br'),
    );
    expect(brotli.headers.get('content-encoding')).toBe('br');
    expect(brotli.headers.get('vary')).toContain('accept-encoding');
    expect(brotli.headers.has('content-length')).toBe(false);
    expect(brotliDecompressSync(Buffer.from(await brotli.arrayBuffer())).toString()).toBe(big);
    const gzip = await compressResponse(json(big), request('gzip'));
    expect(gzip.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await gzip.arrayBuffer())).toString()).toBe(big);
  });

  test('br wins a tie and q=0 excludes an encoding', async () => {
    expect(
      (await compressResponse(json(big), request('gzip, br'))).headers.get('content-encoding'),
    ).toBe('br');
    expect(
      (await compressResponse(json(big), request('gzip;q=0.5, br;q=0.4'))).headers.get(
        'content-encoding',
      ),
    ).toBe('gzip');
    expect(
      (await compressResponse(json(big), request('br;q=0, gzip'))).headers.get('content-encoding'),
    ).toBe('gzip');
    const none = await compressResponse(json(big), request('br;q=0, gzip;q=0'));
    expect(none.headers.has('content-encoding')).toBe(false);
    expect((await compressResponse(json(big), request('*'))).headers.get('content-encoding')).toBe(
      'br',
    );
  });

  test('a body of 1 KiB or less is answered uncompressed with its bytes', async () => {
    const small = 'x'.repeat(1024);
    const answer = await compressResponse(json(small, {}, 'text/plain'), request('br'));
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(answer.headers.get('vary')).toContain('accept-encoding');
    expect(await answer.text()).toBe(small);
  });

  test('an event stream is never compressed, and neither is a binary type', async () => {
    const stream = await compressResponse(json(big, {}, 'text/event-stream'), request('br'));
    expect(stream.headers.has('content-encoding')).toBe(false);
    expect(stream.headers.has('vary')).toBe(false);
    const binary = await compressResponse(json(big, {}, 'application/octet-stream'), request('br'));
    expect(binary.headers.has('content-encoding')).toBe(false);
    const problem = await compressResponse(
      json(big, {}, 'application/problem+json'),
      request('br'),
    );
    expect(problem.headers.get('content-encoding')).toBe('br');
  });

  test('HEAD, 204, 304, an encoded response, no-transform and set-cookie are left as they are', async () => {
    const left = async (response: Response, req = request('br')): Promise<void> => {
      expect(await compressResponse(response, req)).toBe(response);
    };
    await left(json(big), request('br', 'HEAD'));
    await left(
      new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    await left(
      new Response(null, { status: 304, headers: { 'content-type': 'application/json' } }),
    );
    await left(
      json(big, {
        status: 206,
        headers: { 'content-range': `bytes 0-${big.length - 1}/${big.length}` },
      }),
    );
    await left(json(big, { headers: { 'content-encoding': 'gzip' } }));
    await left(json(big, { headers: { 'cache-control': 'no-transform' } }));
    const cookie = json(big);
    cookie.headers.append('set-cookie', 'a=b; Path=/');
    await left(cookie);
  });

  test('a strong etag becomes weak when the body is compressed', async () => {
    const strong = await compressResponse(json(big, { headers: { etag: '"x"' } }), request('gzip'));
    expect(strong.headers.get('etag')).toBe('W/"x"');
    const weak = await compressResponse(json(big, { headers: { etag: 'W/"y"' } }), request('gzip'));
    expect(weak.headers.get('etag')).toBe('W/"y"');
  });

  test('without accept-encoding nothing is compressed', async () => {
    const answer = await compressResponse(json(big), request());
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(await answer.text()).toBe(big);
  });
});
