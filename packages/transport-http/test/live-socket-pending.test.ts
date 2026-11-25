import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeSession } from './support/fake-session.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

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
