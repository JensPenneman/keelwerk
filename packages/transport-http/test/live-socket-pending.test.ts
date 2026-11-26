import { closeCodeOfError, coreError } from '@keelwerk/core/http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { closingLines } from './support/closing-lines.ts';
import { fakeSession } from './support/fake-session.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

const quotaClose = closeCodeOfError(coreError('core.quota_exceeded').kind);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
const clients: LiveSocketClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

/** The tenant's anonymous bound is 4 and one address holds 2: a token in the hello makes the user, no token an anonymous. */
async function started() {
  const made = await socketHost(quietHub({ open: 0 }), {
    host: {
      trustedProxies: ['127.0.0.1'],
      live: { maxStreamsPerPrincipal: 2, maxAnonymousStreamsPerTenant: 4 },
    },
    open: async (carrier) => ({
      ok: true as const,
      value: carrier.token === undefined ? fakeSession() : userSession('ada'),
    }),
  });
  hosts.push(made);
  return made;
}

async function connected(made: SocketHost, address: string): Promise<LiveSocketClient> {
  const client = await made.connect({ 'x-forwarded-for': address });
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  clients.push(client);
  return client;
}

describe('a socket that has not said hello', () => {
  test('fills its own address, never the tenant bound the token clients of the tenant come in under', async () => {
    const made = await started();
    // Two addresses, each at its bound of two sockets that never say hello: four, the tenant's anonymous bound.
    for (const address of ['203.0.113.1', '203.0.113.2']) {
      await connected(made, address);
      await connected(made, address);
    }
    expect(await made.connect({ 'x-forwarded-for': '203.0.113.1' })).toMatchObject({
      status: 429,
      body: { error: { code: 'core.quota_exceeded' } },
    });
    const client = await connected(made, '203.0.113.3');
    client.send({ type: 'hello', token: 'a-token' });
    expect(await client.next()).toMatchObject({ type: 'welcome' });
  });

  test('is closed at the hello timeout and gives its place back', async () => {
    const made = await started();
    const first = await connected(made, '203.0.113.1');
    await connected(made, '203.0.113.1');
    await made.at(10_000);
    expect(await first.closed).toMatchObject({ code: 4000, reason: 'hello_timeout' });
    await connected(made, '203.0.113.1');
  });

  test('takes the tenant anonymous bound with a hello that brings no token, and is refused there when it is full', async () => {
    const made = await started();
    const held: LiveSocketClient[] = [];
    for (const address of ['203.0.113.1', '203.0.113.2']) {
      for (let index = 0; index < 2; index += 1) {
        const client = await connected(made, address);
        client.send({ type: 'hello' });
        expect(await client.next()).toMatchObject({ type: 'welcome' });
        held.push(client);
      }
    }
    // The tenant holds four anonymous sockets that said hello: a fifth is let in, and refused at its hello.
    const fifth = await connected(made, '203.0.113.3');
    fifth.send({ type: 'hello' });
    expect(await fifth.next()).toMatchObject({
      type: 'error',
      error: { code: 'core.quota_exceeded' },
    });
    expect(await fifth.closed).toMatchObject({ reason: 'core.quota_exceeded' });
  });
});

/** The process count of sockets without a first message is 3 and an address holds 1: a token in the hello makes the user. */
async function crowded(extra: Parameters<typeof socketHost>[1] = {}) {
  const made = await socketHost(quietHub({ open: 0 }), {
    host: {
      trustedProxies: ['127.0.0.1'],
      live: { maxStreams: 3, maxStreamsPerPrincipal: 1, maxAnonymousStreamsPerTenant: 50 },
    },
    open: async (carrier) => ({
      ok: true as const,
      value: carrier.token === undefined ? fakeSession() : userSession('ada'),
    }),
    ...extra,
  });
  hosts.push(made);
  return made;
}

describe('a full count of sockets that have not said hello', () => {
  test('ends the oldest waiting one with core.quota_exceeded and serves the new one that says hello at once', async () => {
    const made = await crowded();
    const waiting = [];
    for (const address of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      waiting.push(await connected(made, address));
    }
    const closes: number[] = [];
    for (const [at, client] of waiting.entries()) void client.closed.then(() => closes.push(at));
    // On the code that refuses the new socket at the upgrade this connect throws: the count is full.
    const prompt = await connected(made, '203.0.113.4');
    prompt.send({ type: 'hello', token: 'a-token' });
    expect(await prompt.next()).toMatchObject({ type: 'welcome' });
    // The clock reaches the hello timeout with no real time passing: whoever still waits is closed by it.
    await made.at(10_000);
    // The oldest was ended before that, and told that a bound was full: the error and the close a bound that refuses a socket gives.
    expect(await Promise.race([waiting[0]?.next(), waiting[0]?.closed])).toMatchObject({
      type: 'error',
      error: { code: 'core.quota_exceeded' },
    });
    expect(await waiting[0]?.closed).toMatchObject({
      code: quotaClose,
      reason: 'core.quota_exceeded',
    });
    expect(closes[0]).toBe(0);
    // The others waited on, until their own timeout.
    expect(await waiting[1]?.closed).toMatchObject({ code: 4000, reason: 'hello_timeout' });
    expect(await waiting[2]?.closed).toMatchObject({ code: 4000, reason: 'hello_timeout' });
    expect(prompt.socket.readyState).toBe(prompt.socket.OPEN);
  });

  test('never closes a socket whose first message is being opened: the oldest one that still waits goes', async () => {
    const opening = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const made = await crowded({
      open: async (carrier) => {
        if (carrier.token === 'slow') {
          reached.resolve();
          await opening.promise;
        }
        return {
          ok: true as const,
          value: carrier.token === undefined ? fakeSession() : userSession('ada'),
        };
      },
    });
    const first = await connected(made, '203.0.113.1');
    first.send({ type: 'hello', token: 'slow' });
    await reached.promise;
    const second = await connected(made, '203.0.113.2');
    await connected(made, '203.0.113.3');
    await connected(made, '203.0.113.4');
    opening.resolve();
    expect(await first.next()).toMatchObject({ type: 'welcome' });
    // Whoever still waits is closed by the hello timeout, which the clock reaches at once: the oldest of them was ended before.
    await made.at(10_000);
    expect(await second.closed).toMatchObject({ code: quotaClose, reason: 'core.quota_exceeded' });
  });

  test('refuses an address at its own bound at the upgrade and closes nobody', async () => {
    const made = await crowded();
    const held = [await connected(made, '203.0.113.1'), await connected(made, '203.0.113.2')];
    await connected(made, '203.0.113.3');
    expect(await made.connect({ 'x-forwarded-for': '203.0.113.1' })).toMatchObject({
      status: 429,
      body: { error: { code: 'core.quota_exceeded' } },
    });
    for (const client of held) expect(client.socket.readyState).toBe(client.socket.OPEN);
  });

  test('a waiting socket is ended only when as many sockets as the count arrive after it', async () => {
    const made = await crowded();
    const older = [];
    for (const address of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      older.push(await connected(made, address));
    }
    // Each newcomer ends the oldest one that still waits: the three older ones, one by one.
    const waiting = await connected(made, '203.0.113.50');
    await connected(made, '198.51.100.4');
    await connected(made, '198.51.100.5');
    expect(waiting.socket.readyState).toBe(waiting.socket.OPEN);
    // The third newcomer after it ends it.
    await connected(made, '198.51.100.6');
    // The clock reaches the hello timeout with no real time passing: any socket still waiting is closed by it.
    await made.at(10_000);
    // Each of the older ones was told by an error frame, the one that arrived after them as well; a socket
    // that was not ended by the count shows as its close, at once.
    const told = await Promise.all(
      [...older, waiting].map((client) => Promise.race([client.next(), client.closed])),
    );
    expect(told).toMatchObject([
      { type: 'error', error: { code: 'core.quota_exceeded' } },
      { type: 'error', error: { code: 'core.quota_exceeded' } },
      { type: 'error', error: { code: 'core.quota_exceeded' } },
      { type: 'error', error: { code: 'core.quota_exceeded' } },
    ]);
  });

  test('is left at a count of zero by every way out of the count', async () => {
    const { closed, log } = closingLines();
    const setup = Promise.withResolvers<void>();
    const made = await crowded({
      deps: { log },
      open: async (carrier) => {
        if (carrier.token === 'refused')
          return { ok: false as const, error: coreError('core.unauthenticated') };
        if (carrier.token === 'slow') await setup.promise;
        return {
          ok: true as const,
          value: carrier.token === undefined ? fakeSession() : userSession('ada'),
        };
      },
    });
    // The host writes its line when its side of a socket has ended: the signal that its place is given back.
    const gone = closed;
    // Every step comes from the same address, which holds one place: a place left behind refuses the next.
    const address = '203.0.113.1';
    const hello = await connected(made, address);
    hello.send({ type: 'hello', token: 'a-token' });
    expect(await hello.next()).toMatchObject({ type: 'welcome' });
    await hello.close();
    await gone(1);
    await (await connected(made, address)).close();
    await gone(2);
    const garbage = await connected(made, address);
    garbage.send({ type: 'subscribe', id: 'x', action: 'loans.loanEvents' });
    expect(await garbage.closed).toMatchObject({ code: 4000 });
    await gone(3);
    const refused = await connected(made, address);
    refused.send({ type: 'hello', token: 'refused' });
    expect(await refused.closed).toMatchObject({ code: 4401 });
    await gone(4);
    const aborted = await connected(made, address);
    aborted.send({ type: 'hello', token: 'slow' });
    await aborted.close();
    setup.resolve();
    await gone(5);
    // An eviction: three other addresses fill the count, a fourth ends the oldest.
    const crowd = [];
    for (const other of ['203.0.113.2', '203.0.113.3', '203.0.113.4', '203.0.113.5']) {
      crowd.push(await connected(made, other));
    }
    await made.at(10_000);
    expect(await crowd[0]?.closed).toMatchObject({ reason: 'core.quota_exceeded' });
    await Promise.all(crowd.slice(1).map((client) => client.close()));
    await gone(9);
    // Nothing is left: the same address is admitted again, and the count holds three new sockets.
    for (const other of [address, '203.0.113.2', '203.0.113.3']) {
      expect((await connected(made, other)).socket.readyState).toBe(1);
    }
  });
});
