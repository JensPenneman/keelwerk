import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { clientConnectOf } from '../src/conformance/transport/client-connect-of.ts';
import { clientFetchOf } from '../src/harness/client-fetch-of.ts';
import {
  accept,
  bodies,
  frame,
  listen,
  stopServer,
  upgradeRequest,
} from './support/web-socket-server.ts';

afterEach(stopServer);

describe('clientConnectOf', () => {
  it('answers a refused upgrade as its response, with status, headers and body', async () => {
    const body = '{"error":{"code":"core.csrf"}}';
    const port = await listen((_request, socket) => {
      socket.end(
        `HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\nx-seen: yes\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`,
      );
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    expect(upgrade.kind).toBe('refused');
    if (upgrade.kind !== 'refused') return;
    expect(upgrade.response.status).toBe(403);
    expect(upgrade.response.headers.get('x-seen')).toBe('yes');
    expect(await upgrade.response.json()).toEqual({ error: { code: 'core.csrf' } });
  });

  it('opens with the subprotocol the server chose and reads text, fragmented text and binary messages', async () => {
    const port = await listen((request, socket) => {
      accept(request, socket, 'keelwerk.live.v1');
      socket.write(frame(1, Buffer.from('hello')));
      socket.write(frame(1, Buffer.from('frag'), false));
      socket.write(frame(0, Buffer.from('mented')));
      socket.write(frame(2, Buffer.from([1, 2, 3])));
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(upgrade.protocol).toBe('keelwerk.live.v1');
    expect(upgrade.headers.get('upgrade')).toBe('websocket');
    expect(await upgrade.socket.next()).toBe('hello');
    expect(await upgrade.socket.next()).toBe('fragmented');
    expect(await upgrade.socket.next()).toEqual(new Uint8Array([1, 2, 3]));
    await upgrade.socket.close();
  });

  it('reports the close code and reason of the server, and 1006 when the connection just ends', async () => {
    let calls = 0;
    const port = await listen((request, socket) => {
      accept(request, socket);
      calls += 1;
      if (calls === 1) {
        socket.write(frame(8, Buffer.concat([Buffer.from([0x0f, 0xa0]), Buffer.from('bye')])));
      } else {
        socket.destroy();
      }
    });
    const connect = clientConnectOf(port);
    const first = await connect(upgradeRequest());
    if (first.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(await first.socket.closed).toEqual({ code: 4000, reason: 'bye' });
    await expect(first.socket.next()).rejects.toThrow(/closed/);
    const second = await connect(upgradeRequest());
    if (second.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(await second.socket.closed).toEqual({ code: 1006, reason: '' });
  });

  it('sends the URL host as Host and the named address as the only forwarded entry; a request header never moves it', async () => {
    const seen: IncomingMessage['headers'][] = [];
    const paths: (string | undefined)[] = [];
    const port = await listen((request, socket) => {
      seen.push(request.headers);
      paths.push(request.url);
      accept(request, socket);
    });
    const connect = clientConnectOf(port);
    const upgrade = await connect(
      upgradeRequest('/live?a=1', { 'x-forwarded-for': '9.9.9.9', origin: 'https://x.test' }),
      { remoteAddress: '203.0.113.9' },
    );
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(paths).toEqual(['/live?a=1']);
    expect(seen[0]?.host).toBe('acme.example.test');
    expect(seen[0]?.['x-forwarded-for']).toBe('203.0.113.9');
    expect(seen[0]?.origin).toBe('https://x.test');
    expect(seen[0]?.['sec-websocket-version']).toBe('13');
    await upgrade.socket.close();
  });

  it('gives every connect without an address its own one, from the source it shares with fetch, and refuses an address that is no IP address', async () => {
    const forwarded: (string | string[] | undefined)[] = [];
    const port = await listen((request, socket) => {
      forwarded.push(request.headers['x-forwarded-for']);
      accept(request, socket);
    });
    let count = 0;
    const addresses = () => {
      count += 1;
      return `198.18.0.${count}`;
    };
    const connect = clientConnectOf(port, addresses);
    const fetched: (string | undefined)[] = [];
    const fetch = clientFetchOf(
      {
        fetch: async (_request, options) => {
          fetched.push(options?.remoteAddress);
          return new Response(null);
        },
      },
      addresses,
    );
    const opened = [await connect(upgradeRequest()), await connect(upgradeRequest())];
    await fetch(new Request('https://acme.example.test/'));
    await Promise.all(
      opened.map((entry) => (entry.kind === 'open' ? entry.socket.close() : undefined)),
    );
    expect(forwarded).toEqual(['198.18.0.1', '198.18.0.2']);
    expect(fetched).toEqual(['198.18.0.3']);
    await expect(connect(upgradeRequest(), { remoteAddress: 'not-an-address' })).rejects.toThrow(
      TypeError,
    );
    await expect(connect(upgradeRequest(), { remoteAddress: 'fe80::1%en0' })).rejects.toThrow(
      TypeError,
    );
  });

  it('closes with the given code and reason, and with 1000 and no reason by default', async () => {
    const closes: { code: number; reason: string }[] = [];
    const port = await listen((request, socket) => {
      accept(request, socket);
      socket.on('data', (chunk: Buffer) => {
        for (const entry of bodies(chunk)) {
          if (entry.opcode !== 8) continue;
          closes.push({ code: entry.body.readUInt16BE(0), reason: entry.body.toString('utf8', 2) });
          socket.destroy();
        }
      });
    });
    const connect = clientConnectOf(port);
    const first = await connect(upgradeRequest());
    const second = await connect(upgradeRequest());
    if (first.kind !== 'open' || second.kind !== 'open')
      throw new Error('The upgrade was refused.');
    await first.socket.close(4499, 'späte Antwort');
    await second.socket.close();
    expect(closes).toEqual([
      { code: 4499, reason: 'späte Antwort' },
      { code: 1000, reason: '' },
    ]);
    const third = await connect(upgradeRequest());
    if (third.kind !== 'open') throw new Error('The upgrade was refused.');
    await expect(third.socket.close(70_000)).rejects.toThrow(RangeError);
    await expect(third.socket.close(1000, 'x'.repeat(124))).rejects.toThrow(RangeError);
    await third.socket.close();
  });

  it('gives up a handshake when the signal of the request aborts, before or during the wait', async () => {
    const held: Socket[] = [];
    const port = await listen((_request, socket) => {
      held.push(socket);
      socket.resume();
    });
    const connect = clientConnectOf(port);
    const controller = new AbortController();
    const waiting = connect(
      new Request('https://acme.example.test/live', { signal: controller.signal }),
    );
    await expect.poll(() => held.length).toBe(1);
    controller.abort(new Error('left'));
    await expect(waiting).rejects.toThrow('left');
    await expect.poll(() => held[0]?.readableEnded).toBe(true);
    await expect(
      connect(new Request('https://acme.example.test/live', { signal: AbortSignal.abort() })),
    ).rejects.toThrow(/abort/i);
    expect(held).toHaveLength(1);
  });
});
