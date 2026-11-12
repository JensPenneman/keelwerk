import type { LiveServerMessage } from '@keelwerk/core';
import { expect, test } from 'vitest';
import type { Caller } from './call.ts';
import type { EventStreamReader } from './event-stream-reader.ts';
import { freshName } from './fresh-name.ts';
import { liveMessageUntil } from './live-message-until.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';
import type { TestSocket } from './test-socket.ts';
import type { TransportTarget } from './transport-target.ts';

/** The cases of `keelwerk.live.v1` that need a real handshake (15.4.7, 15.4.10, 16.4.10); skipped without `target.connect` or `target.live`. */
export function liveSocketCases(target: TransportTarget): void {
  const skip = target.connect === undefined || target.live !== true;
  const upgrade = (caller: Caller, remoteAddress?: string): Promise<SocketUpgrade> => {
    if (target.connect === undefined) throw new Error('The target has no connect hook.');
    const headers = requestHeaders(caller);
    headers.set('sec-websocket-protocol', 'keelwerk.live.v1');
    return target.connect(
      new Request(`${originOf(target, caller)}/_keelwerk/v1/live`, { headers }),
      remoteAddress === undefined ? undefined : { remoteAddress },
    );
  };
  const opened = (result: SocketUpgrade): TestSocket => {
    if (result.kind !== 'open')
      throw new Error(`The upgrade was refused: ${result.response.status}.`);
    return result.socket;
  };
  const greeted = async (remoteAddress: string, sockets: TestSocket[]): Promise<TestSocket> => {
    const socket = opened(await upgrade({}, remoteAddress));
    sockets.push(socket);
    socket.send(JSON.stringify({ type: 'hello' }));
    expect((await liveMessageUntil(socket, (m) => m.type === 'welcome')).type).toBe('welcome');
    return socket;
  };

  test.skipIf(skip)(
    'a cross-site page cannot open the live socket with the user’s cookie; its own origin can',
    async () => {
      const ada = freshName('ada');
      const evil: Caller = {
        subject: ada,
        cookie: `user:${ada}`,
        origin: 'https://evil.example',
        fetchSite: 'cross-site',
      };
      const sockets: TestSocket[] = [];
      try {
        const refused = await upgrade(evil);
        if (refused.kind === 'open') sockets.push(refused.socket);
        expect(refused.kind).toBe('refused');
        if (refused.kind === 'refused') {
          expect(refused.response.status).toBe(403);
          expect(await refused.response.json()).toMatchObject({ error: { code: 'core.csrf' } });
        }
        const own: Caller = { subject: ada, cookie: `user:${ada}` };
        const result = await upgrade({ ...own, origin: originOf(target, own) });
        if (result.kind === 'open') sockets.push(result.socket);
        expect(result.kind).toBe('open');
        if (result.kind === 'open') expect(result.protocol).toBe('keelwerk.live.v1');
      } finally {
        await Promise.all(sockets.map((socket) => socket.close()));
      }
    },
  );

  test.skipIf(skip)(
    'anonymous sockets are capped per client address: one address runs out, another does not',
    async () => {
      const held: TestSocket[] = [];
      try {
        // The default cap is 20 streams of one anonymous client address.
        let refused: SocketUpgrade | undefined;
        for (let index = 0; index < 40 && refused === undefined; index += 1) {
          const next = await upgrade({}, '203.0.113.60');
          if (next.kind === 'open') {
            held.push(next.socket);
            next.socket.send(JSON.stringify({ type: 'hello' }));
            await liveMessageUntil(next.socket, (m) => m.type === 'welcome');
          } else {
            refused = next;
          }
        }
        expect(refused?.kind).toBe('refused');
        if (refused?.kind === 'refused') {
          expect(refused.response.status).toBe(429);
          expect(await refused.response.json()).toMatchObject({
            error: { code: 'core.quota_exceeded' },
          });
        }
        expect(held).toHaveLength(20);
        held.push(opened(await upgrade({}, '203.0.113.61')));
      } finally {
        await Promise.all(held.map((socket) => socket.close()));
      }
    },
  );

  test.skipIf(skip)(
    'the subscriptions of an anonymous socket count against its address: one address runs out, another does not',
    async () => {
      const sockets: TestSocket[] = [];
      const subscribe = (socket: TestSocket, id: string): void =>
        socket.send(
          JSON.stringify({ type: 'subscribe', id, action: 'loans.loanTicker', input: {} }),
        );
      const reply = (socket: TestSocket, id: string): Promise<LiveServerMessage> =>
        liveMessageUntil(socket, (m) => 'id' in m && m.id === id);
      // The 20 slots of the address are four sockets and 16 subscriptions, at most six on one socket:
      // far below the per-socket cap of a default runner. The refused subscription goes to the socket
      // that holds none, so a per-socket cap (which also answers `core.quota_exceeded`) cannot be its cause.
      const perSocket = [6, 6, 4];
      // The empty socket, one socket per entry and every subscription each hold one slot.
      const slotsNeeded = 1 + perSocket.length + perSocket.reduce((sum, count) => sum + count, 0);
      let subscribed = 0;
      try {
        const empty = await greeted('203.0.113.70', sockets);
        for (const [position, count] of perSocket.entries()) {
          const socket = await greeted('203.0.113.70', sockets);
          for (let index = 0; index < count; index += 1) {
            const id = `s${position}-${index}`;
            subscribe(socket, id);
            const answer = await reply(socket, id);
            if (answer.type !== 'head') {
              throw new Error(
                `Precondition: the runner must allow ${Math.max(...perSocket)} subscriptions on one socket and ${slotsNeeded} slots (sockets and subscriptions) per anonymous address, but subscription ${index + 1} of socket ${position + 1} of ${perSocket.length} was answered ${JSON.stringify(answer)} while the address held ${sockets.length + subscribed} slots.`,
              );
            }
            subscribed += 1;
          }
        }
        subscribe(empty, 'over');
        expect(await reply(empty, 'over')).toMatchObject({
          type: 'error',
          error: { code: 'core.quota_exceeded' },
        });
        const other = await greeted('203.0.113.71', sockets);
        subscribe(other, 'first');
        expect(await reply(other, 'first')).toMatchObject({ type: 'head' });
      } finally {
        await Promise.all(sockets.map((socket) => socket.close()));
      }
    },
  );

  test.skipIf(skip || target.codec.subscribe === undefined)(
    'streams and sockets of one client address fill one bucket: the next of either kind is refused, another address is not',
    async () => {
      const stream = (remoteAddress: string): Promise<EventStreamReader> => {
        if (target.codec.subscribe === undefined)
          throw new Error('The codec has no stream endpoint.');
        return target.codec.subscribe(target, {
          action: 'loans.loanTicker',
          input: {},
          remoteAddress,
        });
      };
      const streams: EventStreamReader[] = [];
      const sockets: TestSocket[] = [];
      const address = '203.0.113.80';
      try {
        // Alternating, so neither kind reaches the cap of 20 alone: ten streams and ten sockets fill it.
        for (let index = 0; index < 20; index += 1) {
          if (index % 2 === 0) {
            const next = await stream(address);
            streams.push(next);
            expect(next.response.status).toBe(200);
          } else {
            sockets.push(opened(await upgrade({}, address)));
          }
        }
        const refusedStream = await stream(address);
        try {
          expect(refusedStream.response.status).toBe(429);
        } finally {
          await refusedStream.close();
        }
        const refusedSocket = await upgrade({}, address);
        if (refusedSocket.kind === 'open') sockets.push(refusedSocket.socket);
        expect(refusedSocket.kind).toBe('refused');
        if (refusedSocket.kind === 'refused') expect(refusedSocket.response.status).toBe(429);
        const otherStream = await stream('203.0.113.81');
        streams.push(otherStream);
        expect(otherStream.response.status).toBe(200);
        sockets.push(opened(await upgrade({}, '203.0.113.82')));
      } finally {
        await Promise.all([
          ...streams.map((entry) => entry.close()),
          ...sockets.map((socket) => socket.close()),
        ]);
      }
    },
  );
}
