import type { InvocationSession, StateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { closingLines } from './support/closing-lines.ts';
import { fakeSession } from './support/fake-session.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

const hosts: SocketHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const token = (n: number): StateToken =>
  `v2.0.${n}.00000000.00000000000000000000000000000000` as StateToken;
const stream = (invocation: { readonly signal: AbortSignal }) =>
  (async function* () {
    yield { control: 'head', state: token(1) } as const;
    await new Promise<void>((resolve) =>
      invocation.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  })();

async function hello(made: SocketHost) {
  const client = await made.connect();
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  return client;
}

describe('a subscribe that waits for the socket’s session check takes nothing the socket’s close leaves behind', () => {
  test('a check that never answers: the client leaves, the close is logged and its principal slot is free', async () => {
    const lines = closingLines();
    const session = userSession('ada', { revalidate: () => new Promise(() => undefined) });
    const made = await socketHost(stream, {
      session,
      host: { live: { maxStreamsPerPrincipal: 1 }, liveSocket: { revalidateMs: 3_600_000 } },
      deps: { log: lines.log },
    });
    hosts.push(made);
    const first = await hello(made);
    first.send({ type: 'subscribe', id: 'a', action: 'loans.loanEvents', input: {} });
    first.send({ type: 'ping' });
    // The ping is answered while the subscribe waits, and the invoker is never asked.
    expect(await first.next()).toMatchObject({ type: 'pong' });
    expect(made.subscribed).toEqual([]);
    await first.close();
    await lines.closed(1);
    const second = await made.connect();
    expect('socket' in second).toBe(true);
    if ('socket' in second) await second.close();
  });
});

describe('the session check comes before the host’s slot', () => {
  test('a revoked client is refused as revoked when its tenant’s streams (two sockets and a subscription) are all taken, not told of a quota', async () => {
    let revoked = false;
    let session: InvocationSession | undefined;
    session = userSession('ada', {
      revalidate: async () =>
        revoked
          ? { ok: false, error: coreError('core.unauthenticated', { message: 'revoked' }) }
          : { ok: true, value: session as InvocationSession },
    });
    const made = await socketHost(stream, {
      session,
      host: { live: { maxStreamsPerTenant: 3 }, liveSocket: { revalidateMs: 3_600_000 } },
    });
    hosts.push(made);
    const first = await hello(made);
    first.send({ type: 'subscribe', id: 'a', action: 'loans.loanEvents', input: {} });
    expect(await first.next()).toMatchObject({ type: 'head', id: 'a' });
    const second = await hello(made);
    // The bound is reached: while the session holds, one more subscription is a quota answer.
    second.send({ type: 'subscribe', id: 'c', action: 'loans.loanEvents', input: {} });
    expect(await second.next()).toMatchObject({
      type: 'error',
      id: 'c',
      error: { code: 'core.quota_exceeded' },
    });
    revoked = true;
    second.send({ type: 'subscribe', id: 'b', action: 'loans.loanEvents', input: {} });
    const error = await second.until((message) => message.type === 'error');
    expect(error.at(-1)).toMatchObject({ type: 'error', error: { code: 'core.unauthenticated' } });
    expect(await second.closed).toMatchObject({ code: 4401 });
  });
});

describe('a session store that fails during a subscribe', () => {
  test('closes the socket and starts nothing', async () => {
    const session = userSession('ada', {
      revalidate: () => Promise.reject(new Error('the store is down')),
    });
    const made = await socketHost(stream, { session });
    hosts.push(made);
    const client = await hello(made);
    client.send({ type: 'subscribe', id: 'a', action: 'loans.loanEvents', input: {} });
    expect(await client.closed).toMatchObject({ code: 1011 });
    expect(made.subscribed).toEqual([]);
  });
});

describe('a session that no longer holds starts nothing, whatever it is renewed to', () => {
  /** A user's session whose check answers the anonymous session, as a logged-out cookie reopens. */
  const loggedOut = (): InvocationSession =>
    userSession('ada', { revalidate: async () => ({ ok: true, value: fakeSession() }) });

  test('a subscribe on a socket whose session reopens under other credentials is refused and the socket closes 4401', async () => {
    const made = await socketHost(stream, { session: loggedOut() });
    hosts.push(made);
    const client = await hello(made);
    client.send({ type: 'subscribe', id: 'a', action: 'loans.loanEvents', input: {} });
    expect(await client.closed).toMatchObject({ code: 4401 });
    expect(made.subscribed).toEqual([]);
  });

  test('an invoke on such a socket is refused and the socket closes 4401', async () => {
    const made = await socketHost(stream, { session: loggedOut() });
    hosts.push(made);
    const client = await hello(made);
    client.send({ type: 'invoke', id: 'i', request: { action: 'loans.loanEvents' } });
    expect(await client.closed).toMatchObject({ code: 4401 });
  });

  test('the periodic check of such a socket ends it 4401', async () => {
    const made = await socketHost(stream, {
      session: loggedOut(),
      host: { liveSocket: { revalidateMs: 60_000, heartbeatMs: 100_000_000 } },
    });
    hosts.push(made);
    const client = await hello(made);
    await made.at(60_000);
    expect(await client.closed).toMatchObject({ code: 4401 });
  });
});

describe('a logout that commits while a subscription is set up', () => {
  test('is not refused there: the stream ends at the socket’s next check, one revalidateMs after the check that admitted it', async () => {
    let revoked = false;
    // The step of the pinned clock each check of the session ran at: the case moves the clock, nothing else.
    let step = 0;
    const checkedAt: number[] = [];
    let session: InvocationSession | undefined;
    session = userSession('ada', {
      revalidate: async () => {
        checkedAt.push(step);
        return revoked
          ? { ok: false, error: coreError('core.unauthenticated', { message: 'revoked' }) }
          : { ok: true, value: session as InvocationSession };
      },
    });
    const made = await socketHost(
      (invocation) => {
        // The set-up of the subscription: the logout commits now, after the check answered.
        revoked = true;
        return stream(invocation);
      },
      // The heartbeat sits beyond every step, so no ping and no pong deadline of it falls in the case.
      { session, host: { liveSocket: { revalidateMs: 60_000, heartbeatMs: 100_000_000 } } },
    );
    hosts.push(made);
    const client = await hello(made);
    step = 30_000;
    made.moveTo(step);
    client.send({ type: 'subscribe', id: 'a', action: 'loans.loanEvents', input: {} });
    expect(await client.next()).toMatchObject({ type: 'head', id: 'a' });
    // One revalidateMs after the socket opened, only half of it after the check that admitted the subscription:
    // no check runs. The pong is the barrier: the host has handled everything the step started.
    step = 60_000;
    await made.at(step);
    client.send({ type: 'ping' });
    expect(await client.next()).toMatchObject({ type: 'pong' });
    step = 90_000;
    await made.at(step);
    expect(await client.closed).toMatchObject({ code: 4401 });
    expect(checkedAt).toEqual([30_000, 90_000]);
  });
});
