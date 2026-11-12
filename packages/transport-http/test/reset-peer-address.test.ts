import { connect } from 'node:net';
import { unknownClientAddress } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import type { HostContext } from '../src/host-context.ts';
import { noteConnection } from '../src/note-connection.ts';
import { socketFacts } from '../src/socket-facts.ts';
import { trustedProxies } from '../src/trusted-proxies.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

/** Connects, waits until the server has accepted, then sends one complete request and resets the connection in the same turn. */
async function postAndReset(port: number): Promise<void> {
  const body = JSON.stringify({ action: 'library.lookup' });
  const socket = connect({ port, host: '127.0.0.1' });
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.on('error', () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.write(
    `POST /_keelwerk/v1/invoke HTTP/1.1\r\nhost: x.example\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
  );
  socket.resetAndDestroy();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe('the client address of a request whose client reset the connection', () => {
  it('is the real peer when it was known as the connection opened and gone when the request was read', async () => {
    const { host, invoker } = setup({ listen: { port: 0 } });
    const { port } = await host.listen();
    await postAndReset(port ?? 0);
    expect(invoker.opened.map((call) => call.connection?.remote.address)).toEqual(['127.0.0.1']);
  });
});

describe('the peer address of a connection', () => {
  const context = (): HostContext => ({ connectionIds: new WeakMap() }) as unknown as HostContext;

  it('is kept from the moment the connection opened, though the socket forgets it', () => {
    const host = context();
    const socket: { remoteAddress: string | undefined } = { remoteAddress: '203.0.113.5' };
    const first = noteConnection(host.connectionIds, socket);
    socket.remoteAddress = undefined;
    expect(noteConnection(host.connectionIds, socket)).toBe(first);
    expect(first.peer).toBe('203.0.113.5');
  });

  it('is what the request of a connection that was reset is charged to', () => {
    const host = {
      ...context(),
      proxies: { clientAddress: (peer: string) => peer },
    } as unknown as HostContext;
    const socket = { remoteAddress: '203.0.113.5', remotePort: 4000, localPort: 80 };
    noteConnection(host.connectionIds, socket);
    Object.assign(socket, { remoteAddress: undefined });
    const request = new Request('http://x.example/');
    const facts = socketFacts(host, request, {
      incoming: { socket } as never,
      state: {} as never,
    });
    expect(facts.remote.address).toBe('203.0.113.5');
  });

  it('is the shared unknown bucket when the peer was never known, never the loopback', () => {
    const host = { ...context(), proxies: trustedProxies([]) } as unknown as HostContext;
    const socket = { remoteAddress: undefined, remotePort: undefined, localPort: 80 };
    const facts = socketFacts(host, new Request('http://x.example/'), {
      incoming: { socket } as never,
      state: {} as never,
    });
    expect(facts.remote.address).toBe(unknownClientAddress);
  });

  it('is no trusted proxy when the peer is unknown, so its forwarding header is not read', () => {
    const host = { ...context(), proxies: trustedProxies(['127.0.0.1']) } as unknown as HostContext;
    const socket = { remoteAddress: undefined, remotePort: undefined, localPort: 80 };
    const request = new Request('http://x.example/', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    const facts = socketFacts(host, request, { incoming: { socket } as never, state: {} as never });
    expect(facts.remote.address).toBe(unknownClientAddress);
  });
});
