import type { LiveServerMessage } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import type { Caller } from './call.ts';
import type { EventStreamReader } from './event-stream-reader.ts';
import { freshName } from './fresh-name.ts';
import { liveSocketDialect } from './live-socket-dialect.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import type { SocketDialect } from './socket-dialect.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';
import { steppedClockStepMs } from './stepped-clock-step-ms.ts';
import { steppedClockWait } from './stepped-clock-wait.ts';
import type { TestSocket } from './test-socket.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * The cases of a WebSocket protocol that need a real handshake (15.4.7, 15.4.10, 16.4.10), spoken
 * through the codec's socket dialect (`keelwerk.live.v1` when it has none); skipped without
 * `target.connect` or `target.live`. The deprecated-version case reads raw live frames and always
 * runs on `keelwerk.live.v1`.
 */
export function liveSocketCases(target: TransportTarget): void {
  const skip = target.connect === undefined || target.live !== true;
  const { bounds } = target;
  const deprecated = Object.entries(target.tenants).find(
    ([, tenant]) => tenant.deprecatedApiVersion !== undefined,
  );
  const dialect: SocketDialect = target.codec.socket ?? liveSocketDialect;
  const upgradeWith = (
    spoken: SocketDialect,
    caller: Caller,
    remoteAddress?: string,
  ): Promise<SocketUpgrade> => {
    if (target.connect === undefined) throw new Error('The target has no connect hook.');
    const headers = requestHeaders(caller);
    headers.set('sec-websocket-protocol', spoken.protocol);
    return target.connect(
      new Request(`${originOf(target, caller)}${spoken.path}`, { headers }),
      remoteAddress === undefined ? undefined : { remoteAddress },
    );
  };
  const upgrade = (caller: Caller, remoteAddress?: string): Promise<SocketUpgrade> =>
    upgradeWith(dialect, caller, remoteAddress);
  const opened = (result: SocketUpgrade): TestSocket => {
    if (result.kind !== 'open')
      throw new Error(`The upgrade was refused: ${result.response.status}.`);
    return result.socket;
  };
  const greeted = async (remoteAddress: string, sockets: TestSocket[]): Promise<TestSocket> => {
    const socket = opened(await upgrade({}, remoteAddress));
    sockets.push(socket);
    await dialect.open(socket);
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
        if (result.kind === 'open') expect(result.protocol).toBe(dialect.protocol);
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
        // The cap of the host: streams of one anonymous client address.
        let refused: SocketUpgrade | undefined;
        for (
          let index = 0;
          index < 2 * bounds.maxStreamsPerPrincipal && refused === undefined;
          index += 1
        ) {
          const next = await upgrade({}, '203.0.113.60');
          if (next.kind === 'open') {
            held.push(next.socket);
            await dialect.open(next.socket);
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
        expect(held).toHaveLength(bounds.maxStreamsPerPrincipal);
        held.push(opened(await upgrade({}, '203.0.113.61')));
      } finally {
        await Promise.all(held.map((socket) => socket.close()));
      }
    },
  );

  test.skipIf(skip || bounds.maxStreamsPerPrincipal !== 20 || bounds.maxSubscriptionsPerSocket < 6)(
    'the subscriptions of an anonymous socket count against its address: one address runs out, another does not',
    async () => {
      const sockets: TestSocket[] = [];
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
            const answer = await dialect.subscribe(socket, id);
            if (answer.kind !== 'head') {
              throw new Error(
                `Precondition: the runner must allow ${Math.max(...perSocket)} subscriptions on one socket and ${slotsNeeded} slots (sockets and subscriptions) per anonymous address, but subscription ${index + 1} of socket ${position + 1} of ${perSocket.length} was answered ${JSON.stringify(answer)} while the address held ${sockets.length + subscribed} slots.`,
              );
            }
            subscribed += 1;
          }
        }
        expect(await dialect.subscribe(empty, 'over')).toEqual({
          kind: 'refused',
          code: 'core.quota_exceeded',
        });
        const other = await greeted('203.0.113.71', sockets);
        expect(await dialect.subscribe(other, 'first')).toEqual({ kind: 'head' });
      } finally {
        await Promise.all(sockets.map((socket) => socket.close()));
      }
    },
  );

  test.skipIf(skip || target.revoke === undefined || target.advance === undefined)(
    'a running subscription whose session was revoked ends with its error and the socket closes 4401',
    async () => {
      const sockets: TestSocket[] = [];
      try {
        // The runner sets the host's `revalidateMs` and `heartbeatMs` far beyond the clock's steps, so
        // only the session check that the failing subscription asks for can close the socket, and no
        // ping's pong deadline passes between two steps.
        const subject = freshName('ada');
        const socket = opened(await upgrade({ subject }, '203.0.113.95'));
        sockets.push(socket);
        await dialect.open(socket);
        expect(await dialect.subscribe(socket, 'first')).toEqual({ kind: 'head' });
        target.revoke?.(subject);
        let closed: { readonly code: number; readonly reason: string } | undefined;
        void socket.closed.then((result) => {
          closed = result;
        });
        // The hub counts a minute of the runtime's clock from the first of its own ticks that sees
        // the subscription, so the clock moves again until the socket is seen closed.
        await vi.waitFor(async () => {
          await target.advance?.(steppedClockStepMs);
          expect(closed).toBeDefined();
        }, steppedClockWait);
        expect(closed).toMatchObject({ code: 4401 });
      } finally {
        await Promise.all(sockets.map((socket) => socket.close()));
      }
    },
    2 * steppedClockWait.timeout,
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
        // Alternating, so neither kind reaches the cap alone: half of each fill it.
        for (let index = 0; index < bounds.maxStreamsPerPrincipal; index += 1) {
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

  test.skipIf(skip || deprecated === undefined)(
    'a socket of a tenant pinned to a deprecated API version gets its notice before the head of its first subscription',
    async () => {
      if (deprecated === undefined)
        throw new Error('The target has no tenant on a deprecated version.');
      const [tenant, pinned] = deprecated;
      const sockets: TestSocket[] = [];
      try {
        const socket = opened(await upgradeWith(liveSocketDialect, { tenant }, '203.0.113.90'));
        sockets.push(socket);
        const next = async (): Promise<LiveServerMessage> =>
          JSON.parse(String(await socket.next())) as LiveServerMessage;
        socket.send(JSON.stringify({ type: 'hello' }));
        expect(await next()).toMatchObject({
          type: 'welcome',
          apiVersion: pinned.deprecatedApiVersion,
        });
        expect(await next()).toMatchObject({
          type: 'notice',
          notice: { kind: 'deprecation', apiVersion: pinned.deprecatedApiVersion },
        });
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            id: 'ticker',
            action: 'loans.loanTicker',
            input: {},
          }),
        );
        expect(await next()).toMatchObject({ type: 'head', id: 'ticker' });
      } finally {
        await Promise.all(sockets.map((socket) => socket.close()));
      }
    },
  );
}
