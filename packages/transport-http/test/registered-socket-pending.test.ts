import { pinnedLiveTimers } from '@keelwerk/testing';
import { expect, test, vi } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import {
  connectRegisteredSocket,
  liveCarrier,
  opened,
  protocol,
  registeredSocketKit,
} from './support/registered-socket-kit.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const { setup } = registeredSocketKit();

test('a full count closes the oldest waiting socket of a transport 1013 with no frame, and spares one whose first message came', async () => {
  const start = Temporal.Instant.from('2026-11-11T12:00:00Z');
  let now = start;
  const clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const held = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  const made = setup(
    { listen: { port: 0 }, live: { maxStreams: 2, maxStreamsPerPrincipal: 10 } },
    createFakeInvoker({
      open: async (carrier) => {
        if (carrier.token === 'slow') {
          reached.resolve();
          await held.promise;
        }
        return { ok: true as const, value: fakeSession() };
      },
    }),
    { liveCarrier, clock, timers },
  );
  made.host.upgrade(
    { app: 'library', transport: 'chat', path: '/chat', protocols: [protocol] },
    {
      open(socket, _ctx, connection) {
        socket.addEventListener('message', (event) => {
          void connection.open({ token: String(event.data) });
        });
      },
    },
  );
  const { port } = await made.host.listen();
  const spared = opened(await connectRegisteredSocket(port ?? 0));
  spared.socket.send('slow');
  await reached.promise;
  const oldest = opened(await connectRegisteredSocket(port ?? 0));
  const newest = opened(await connectRegisteredSocket(port ?? 0));
  // The clock reaches the first-message deadline with no real time passing: whoever still waits is closed by it.
  now = start.add({ milliseconds: 10_000 });
  await timers.fire();
  expect(await oldest.closed).toBe(1013);
  expect(oldest.texts).toEqual([]);
  // The newest waited on until its own deadline, which closes it with the protocol's own code.
  expect(await newest.closed).not.toBe(1013);
  held.resolve();
  expect(spared.socket.readyState).toBe(spared.socket.OPEN);
});
