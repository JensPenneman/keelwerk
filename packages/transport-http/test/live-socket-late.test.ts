import type { InvocationSession, StateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import {
  connectRegisteredSocket,
  liveCarrier,
  opened as openedRegistered,
  protocol,
  registeredSocketKit,
} from './support/registered-socket-kit.ts';
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
const expiresAfterMs = 10_000;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const expired = () => coreError('core.unauthenticated', { message: 'The session expired.' });

/**
 * What the client got, in order, once the socket is closed: a short label per frame and the close. A
 * socket the host has not ended by now is closed by the client, so a message dropped without ending the
 * socket shows as another close code at once, not at a time limit.
 */
async function ended(client: LiveSocketClient) {
  await settle();
  await client.close();
  const close = await client.closed;
  const frames: string[] = [];
  for (;;) {
    try {
      const frame = (await client.next(0)) as {
        type: string;
        id?: string;
        error?: { code: string };
      };
      frames.push(
        [frame.type, frame.id, frame.error?.code].filter((part) => part !== undefined).join(':'),
      );
    } catch {
      return { close, frames };
    }
  }
}

/**
 * A socket whose session expires `expiresMs` after the start; each id is a subscription whose item waits
 * on `late`. `sent` settles when every item has been handed to the host (sent or dropped).
 */
async function opened(
  ids: readonly string[],
  expiresMs: number,
  revalidate: (self: () => InvocationSession) => InvocationSession['revalidate'],
) {
  const late = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<void>();
  let handed = 0;
  let session: InvocationSession | undefined;
  session = userSession('ada', {
    expiresAt: start.add({ milliseconds: expiresMs }),
    revalidate: revalidate(() => session as InvocationSession),
  });
  const made = await socketHost(
    (invocation) =>
      (async function* () {
        yield { control: 'head', state: token(1) } as const;
        await late.promise;
        try {
          yield { event: 'late', state: token(2) };
        } finally {
          handed += 1;
          if (handed >= ids.length) sent.resolve();
        }
        await new Promise<void>((resolve) =>
          invocation.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      })(),
    { session, host: { liveSocket: { revalidateMs: 3_600_000 } } },
  );
  hosts.push(made);
  const client = await made.connect();
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  for (const id of ids) {
    client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });
    expect(await client.next()).toMatchObject({ type: 'head', id });
  }
  return { made, client, late, sent };
}

const never = () => () => new Promise<never>(() => undefined);
const endedByExpiry = {
  close: { code: 4401, reason: 'core.unauthenticated' },
  frames: ['error:core.unauthenticated'],
};

describe('an item the host sends on a socket after its session expired, before the timer of the expiry ran', () => {
  test('one millisecond before the expiry it reaches the client', async () => {
    const { made, client, late } = await opened(['a'], expiresAfterMs, never);
    made.moveTo(expiresAfterMs - 1);
    late.resolve();
    expect(await client.next()).toMatchObject({ type: 'data', id: 'a' });
  });

  test('at exactly the expiry no item reaches the client: one error frame, then the close, with two subscriptions', async () => {
    const { made, client, late, sent } = await opened(['a', 'b'], expiresAfterMs, never);
    // The clock stands at the expiry and no timer has fired; both items are sent now.
    made.moveTo(expiresAfterMs);
    late.resolve();
    await sent.promise;
    expect(await ended(client)).toEqual(endedByExpiry);
    // The timers fire after the items, as a late timer does: nothing more comes of them.
    await made.at(expiresAfterMs);
  });

  test.each([
    ['the check at the expiry refuses first', true],
    ['the item is sent first', false],
  ] as const)(
    'with traffic at the expiry, %s: no item follows the error frame',
    async (_title, checkFirst) => {
      const state = { past: false, checks: 0 };
      const { made, client, late, sent } = await opened(
        ['a'],
        expiresAfterMs,
        (self) => async () => {
          state.checks += 1;
          return state.past ? { ok: false, error: expired() } : { ok: true, value: self() };
        },
      );
      // The check a second before the expiry finds the session good.
      await made.at(expiresAfterMs - 1000);
      await settle();
      expect(state.checks).toBe(1);
      state.past = true;
      if (checkFirst) {
        const firing = made.at(expiresAfterMs);
        late.resolve();
        await firing;
      } else {
        late.resolve();
        await made.at(expiresAfterMs);
      }
      await sent.promise;
      expect(await ended(client)).toEqual(endedByExpiry);
    },
  );

  test('a renewable session is renewed before its expiry, so the item at the old expiry reaches the client', async () => {
    const renewals = { count: 0 };
    const { made, client, late } = await opened(['a'], expiresAfterMs, () => async () => {
      renewals.count += 1;
      return {
        ok: true,
        value: userSession('ada', { expiresAt: start.add({ milliseconds: 2 * expiresAfterMs }) }),
      };
    });
    // The check starts a second before the expiry; nothing else has fired.
    await made.at(expiresAfterMs - 1000);
    await settle();
    expect(renewals.count).toBe(1);
    made.moveTo(expiresAfterMs);
    late.resolve();
    expect(await client.next()).toMatchObject({ type: 'data', id: 'a' });
  });
});

describe('a socket whose session is not renewed', () => {
  test('an idle one ends at its expiry, though the floor of the next check lies after it', async () => {
    const { made, client } = await opened([], 1_500, (self) => async () => ({
      ok: true,
      value: self(),
    }));
    // The check a second before the expiry would fall at 0.5 s, the floor puts it at 1 s: the next one
    // would come at 2 s, after the expiry.
    await made.at(1_000);
    await settle();
    await made.at(1_500);
    expect(await ended(client)).toEqual(endedByExpiry);
  });

  test('no welcome goes out to a session that expired before the hello', async () => {
    const session = userSession('ada', {
      expiresAt: start.add({ milliseconds: 5_000 }),
      revalidate: never(),
    });
    const made = await socketHost(() => (async function* () {})(), {
      session,
      host: { liveSocket: { revalidateMs: 3_600_000 } },
    });
    hosts.push(made);
    const client = await made.connect();
    if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
    made.moveTo(5_000);
    client.send({ type: 'hello' });
    // The first frame is the host's ending, not a welcome.
    expect(await client.next()).toMatchObject({
      type: 'error',
      error: { code: 'core.unauthenticated' },
    });
    expect(await client.closed).toMatchObject({ code: 4401, reason: 'core.unauthenticated' });
  });
});

describe('the check a second before the expiry', () => {
  test('that never answers does not hold the socket open past the expiry', async () => {
    const { made, client } = await opened([], expiresAfterMs, never);
    await made.at(expiresAfterMs - 1000);
    await settle();
    await made.at(expiresAfterMs);
    expect(await ended(client)).toEqual(endedByExpiry);
  });

  test('that answers with a renewal at or after the expiry is dropped: the socket ends', async () => {
    const answer = Promise.withResolvers<void>();
    const checks = { count: 0 };
    const { made, client } = await opened([], expiresAfterMs, () => async () => {
      checks.count += 1;
      await answer.promise;
      return {
        ok: true,
        value: userSession('ada', { expiresAt: start.add({ milliseconds: 2 * expiresAfterMs }) }),
      };
    });
    await made.at(expiresAfterMs - 1000);
    await settle();
    expect(checks.count).toBe(1);
    // The clock stands at the expiry with no timer fired, and only then does the renewal come.
    made.moveTo(expiresAfterMs);
    answer.resolve();
    expect(await ended(client)).toEqual(endedByExpiry);
  });
});

const { setup } = registeredSocketKit();

describe('a message the handler of a transport socket sends at or after the expiry, before its timer ran', () => {
  test.each([
    [expiresAfterMs - 1, 'reaches the client'],
    [expiresAfterMs, 'never reaches the client: the socket closes 4401'],
  ] as const)('with the clock at %i ms it %s', async (at, outcome) => {
    const sent = Promise.withResolvers<void>();
    let now = start;
    const clock = { now: () => now };
    const session = userSession('ada', {
      expiresAt: start.add({ milliseconds: expiresAfterMs }),
      revalidate: () => new Promise(() => undefined),
    });
    const made = setup(
      { listen: { port: 0 }, liveSocket: { revalidateMs: 3_600_000 } },
      createFakeInvoker({ open: () => ({ ok: true, value: session }) }),
      { liveCarrier, clock, timers: pinnedLiveTimers(clock) },
    );
    made.host.upgrade(
      { app: 'library', transport: 'chat', path: '/chat', protocols: [protocol] },
      {
        open(socket, _ctx, connection) {
          socket.addEventListener('message', async (event) => {
            if (String(event.data) === 'open') {
              await connection.open({});
              socket.send('opened');
            } else {
              socket.send('late');
              sent.resolve();
            }
          });
        },
      },
    );
    const { port } = await made.host.listen();
    const client = openedRegistered(await connectRegisteredSocket(port ?? 0));
    client.socket.send('open');
    expect(await client.next()).toBe('opened');
    now = start.add({ milliseconds: at });
    client.socket.send('late');
    if (outcome === 'reaches the client') {
      expect(await client.next()).toBe('late');
    } else {
      // The handler has sent: a socket that is not ended by now is closed by the client, with another code.
      await sent.promise;
      client.socket.close();
      expect(await client.closed).toBe(4401);
      expect(client.texts).toEqual([]);
    }
  });
});
