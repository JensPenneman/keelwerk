import type { InvocationSession, StateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { afterEach, expect, test, vi } from 'vitest';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const token = (n: number): StateToken =>
  `v2.0.${n}.00000000.00000000000000000000000000000000` as StateToken;
const start = Temporal.Instant.from('2026-11-11T12:00:00Z');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('no data frame follows the start of the ending for a retired version, though the expiry falls inside it', async () => {
  const lateB = Promise.withResolvers<void>();
  let made: SocketHost | undefined;
  let subscribed = 0;
  // Each subscribe meets the session check first, and the session holds then; the check a second before the expiry finds the version retired.
  let admitted = 2;
  const session: InvocationSession = userSession('ada', {
    expiresAt: start.add({ milliseconds: 10_000 }),
    revalidate: async () =>
      admitted-- > 0
        ? { ok: true, value: session }
        : { ok: false, error: coreError('core.api_version_retired') },
  });
  made = await socketHost(
    (invocation) => {
      subscribed += 1;
      const which = subscribed;
      return (async function* () {
        yield { control: 'head', state: token(1) } as const;
        if (which === 1) {
          // When the ending ends subscription a, the clock reaches the expiry and b's item is ready.
          await new Promise<void>((resolve) =>
            invocation.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          made?.moveTo(10_000);
          lateB.resolve();
          return;
        }
        await lateB.promise;
        yield { event: 'late', state: token(2) };
        await new Promise<void>((resolve) =>
          invocation.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      })();
    },
    { session, host: { liveSocket: { revalidateMs: 3_600_000 } } },
  );
  hosts.push(made);
  const client = await made.connect();
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  for (const id of ['a', 'b']) {
    client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });
    expect(await client.next()).toMatchObject({ type: 'head', id });
  }
  // The check a second before the expiry answers that the version is retired.
  await made.at(9_000);
  await settle();
  const close = await client.closed;
  const frames: string[] = [];
  for (;;) {
    try {
      const frame = (await client.next(0)) as { type: string; id?: string; reason?: string };
      frames.push(
        [frame.type, frame.id, frame.reason].filter((part) => part !== undefined).join(':'),
      );
    } catch {
      break;
    }
  }
  expect({ close, frames }).toEqual({
    close: { code: 1000, reason: 'version_retired' },
    frames: ['end:a:version_retired', 'end:b:version_retired'],
  });
});
