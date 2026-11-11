import { connect, Socket } from 'node:net';
import type { LiveCarrier } from '@keelwerk/core';
import { recordingLogger } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { createFakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeAction, fakeSurface, stringNode } from './support/fake-surface.ts';

vi.setConfig({ testTimeout: 30_000 });

describe('a stream that fails inside', () => {
  test('an item that cannot be encoded ends the stream with an internal error and logs one line', async () => {
    const lines: Parameters<typeof recordingLogger>[0] = [];
    const wired: unknown[] = [];
    const carrier: LiveCarrier = {
      name: 'sse',
      serve: async (stream, _connection, options) => {
        try {
          for await (const frame of stream) wired.push(frame);
        } catch (failure) {
          wired.push(options.wireError?.(failure));
        }
      },
    };
    const invoker = {
      ...createFakeInvoker(),
      subscribe: () =>
        (async function* () {
          yield await Promise.resolve({ event: 12345 });
        })(),
    } as unknown as ReturnType<typeof createFakeInvoker>;
    const { host } = createFakeHost(
      {},
      {
        invoker,
        surface: fakeSurface([
          fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode }),
        ]),
        deps: { log: recordingLogger(lines), liveCarrier: () => carrier },
      },
    );
    try {
      const response = await host.fetch(
        new Request('https://x.example/_keelwerk/v1/subscribe?action=loans.loanEvents'),
      );
      expect(response.status).toBe(200);
      await response.body?.cancel();
      await vi.waitFor(() => expect(wired).toHaveLength(1));
      expect(wired[0]).toMatchObject({ kind: 'internal' });
      const failed = lines.filter((line) => line.level === 'error');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.message).toBe('stream failed');
    } finally {
      await host.stop(100);
    }
  });
});

describe('over a real socket', () => {
  test('a client that does not read has its socket closed after stallMs and the carrier told', async () => {
    let writes = 0;
    let carrierEnded = false;
    let carrierEnd: () => void = () => undefined;
    const carrierDone = new Promise<void>((resolve) => {
      carrierEnd = resolve;
    });
    const carrier: LiveCarrier = {
      name: 'sse',
      serve: async (_stream, connection) => {
        if (connection.kind !== 'sse') return;
        try {
          for (;;) {
            await connection.write('x'.repeat(65_536));
            writes += 1;
          }
        } catch {
          carrierEnded = true;
          carrierEnd();
        }
      },
    };
    const invoker = {
      ...createFakeInvoker(),
      subscribe: () => (async function* () {})(),
    } as unknown as ReturnType<typeof createFakeInvoker>;
    const { host } = createFakeHost(
      { listen: { port: 0 }, live: { maxBufferedBytes: 100_000, stallMs: 100 } },
      {
        invoker,
        surface: fakeSurface([
          fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode }),
        ]),
        deps: { liveCarrier: () => carrier },
      },
    );
    try {
      const { port } = await host.listen();
      if (port === undefined) throw new Error('the host has no port');
      // The server's side of the connection is the socket whose local port is the listener's.
      const original = Socket.prototype.destroy;
      let serverSocketDestroyed: () => void = () => undefined;
      const destroyedByServer = new Promise<void>((resolve) => {
        serverSocketDestroyed = resolve;
      });
      vi.spyOn(Socket.prototype, 'destroy').mockImplementation(function (this: Socket, ...args) {
        if (this.localPort === port) serverSocketDestroyed();
        return original.apply(this, args);
      });
      const client = connect(port, '127.0.0.1');
      client.on('error', () => undefined);
      const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
      client.write(
        [
          'GET /_keelwerk/v1/subscribe?action=loans.loanEvents HTTP/1.1',
          'Host: x.example',
          '',
          '',
        ].join('\r\n'),
      );
      // The client never reads: the kernel buffers fill, the response waits for the socket, the
      // queue passes its bound, and the stall ends the carrier's writes and destroys the socket, while
      // the client has still read nothing.
      await carrierDone;
      // Left alone, the server's own socket timeout would close it after about five seconds: the
      // stall must have closed it long before.
      const early = await Promise.race([
        destroyedByServer.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
      ]);
      expect(early).toBe(true);
      client.resume();
      await closed;
      expect(client.destroyed).toBe(true);
      expect(carrierEnded).toBe(true);
      expect(writes).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
      await host.stop(100);
    }
  });
});
