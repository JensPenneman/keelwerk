import { coreApiVersions } from '@keelwerk/core';
import { freshName, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { LiveApp } from '../live-app.ts';
import {
  due,
  fastRetry,
  liveStreamsApp,
  principalHeaders,
  withHeaders,
} from './support/live-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** The newest API version the fixture app serves: it declares none, so the core's. */
const headVersion = coreApiVersions.dates.at(-1) ?? '';
const runtime = await startTransportRuntime({
  app: liveStreamsApp,
  host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
});
afterAll(() => runtime.stop());

const origin = `http://127.0.0.1:${runtime.runtime.port ?? 0}`;
const tenant = runtime.tenants.acme ?? '';

type SocketConstructor = new (
  url: string,
  options: { protocols: string[]; headers: Record<string, string> },
) => WebSocket;

function clientFor(subject: string, sockets: WebSocket[]) {
  const headers = { ...principalHeaders(subject), 'x-tenant': tenant };
  return createRemoteClient<LiveApp>({
    url: origin,
    apiVersion: headVersion,
    live: 'websocket',
    fetch: withHeaders((request) => fetch(request), headers),
    webSocket: (url, protocols) => {
      const socket = new (WebSocket as unknown as SocketConstructor)(url, {
        protocols: [...protocols],
        headers,
      });
      sockets.push(socket);
      return socket;
    },
    retry: fastRetry,
  });
}

describe('the remote client subscribes over the keelwerk.live.v1 WebSocket', () => {
  it('yields head and the items of the stream', async () => {
    const sockets: WebSocket[] = [];
    const client = clientFor(freshName('ada'), sockets);
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      await client.invoke('loans.lend', { bookTitle: freshName('Dune'), dueAt: due });
      expect((await frames.next()).value).toMatchObject({ event: { kind: 'created' } });
    } finally {
      await frames.return?.();
    }
  });

  it('reopens from the last token after the connection closed: the loan lent meanwhile arrives', async () => {
    const sockets: WebSocket[] = [];
    const client = clientFor(freshName('ada'), sockets);
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      sockets[0]?.close(1000);
      await client.invoke('loans.lend', { bookTitle: freshName('Emma'), dueAt: due });
      expect((await frames.next()).value).toMatchObject({ event: { kind: 'created' } });
      expect(sockets.length).toBeGreaterThan(1);
    } finally {
      await frames.return?.();
    }
  });
});
