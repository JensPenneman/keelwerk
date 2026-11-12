import { afterEach, describe, expect, test, vi } from 'vitest';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, type SocketHostOptions, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
const clients: LiveSocketClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

async function started(state: { open: number }, options: SocketHostOptions = {}) {
  const made = await socketHost(quietHub(state), {
    ...options,
    host: { trustedProxies: ['127.0.0.1'], ...options.host },
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

async function helloed(made: SocketHost, address: string): Promise<LiveSocketClient> {
  const client = await connected(made, address);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  return client;
}

const subscribe = (client: LiveSocketClient, id: string) =>
  client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });

describe('the anonymous sockets of one address', () => {
  test('stop at 20, the 21st is 429, and another address is let in', async () => {
    const made = await started({ open: 0 });
    for (let index = 0; index < 20; index += 1) await connected(made, '203.0.113.7');
    const refused = await made.connect({ 'x-forwarded-for': '203.0.113.7' });
    expect(refused).toMatchObject({
      status: 429,
      body: { error: { code: 'core.quota_exceeded' } },
    });
    await connected(made, '203.0.113.8');
  });
});

describe('the subscriptions of a socket', () => {
  test('count against the tenant bound, and a subscription that ends gives its slot back', async () => {
    const state = { open: 0 };
    // The socket holds one slot, so three subscriptions fill the four of the tenant.
    const made = await started(state, {
      session: userSession('ada'),
      host: { live: { maxStreamsPerTenant: 4 } },
    });
    const client = await helloed(made, '203.0.113.7');
    for (const id of ['a', 'b', 'c', 'd']) subscribe(client, id);
    const refused = await client.until((message) => message.type === 'error');
    expect(refused.at(-1)).toMatchObject({
      type: 'error',
      id: 'd',
      error: { code: 'core.quota_exceeded' },
    });
    await vi.waitFor(() => expect(state.open).toBe(3));
    client.send({ type: 'unsubscribe', id: 'a' });
    await vi.waitFor(() => expect(state.open).toBe(2));
    subscribe(client, 'e');
    await vi.waitFor(() => expect(state.open).toBe(3));
  });

  test('count against the tenant bound of all its sockets, so two sockets share it', async () => {
    const state = { open: 0 };
    const made = await started(state, {
      session: userSession('ada'),
      host: { live: { maxStreamsPerTenant: 5 } },
    });
    const first = await helloed(made, '203.0.113.7');
    const second = await helloed(made, '203.0.113.8');
    for (const id of ['a', 'b']) subscribe(first, id);
    await vi.waitFor(() => expect(state.open).toBe(2));
    subscribe(second, 'c');
    await vi.waitFor(() => expect(state.open).toBe(3));
    subscribe(second, 'd');
    expect((await second.until((message) => message.type === 'error')).at(-1)).toMatchObject({
      id: 'd',
      error: { code: 'core.quota_exceeded' },
    });
  });

  test('of anonymous sockets count against the anonymous bound of the tenant', async () => {
    const state = { open: 0 };
    const made = await started(state, { host: { live: { maxAnonymousStreamsPerTenant: 3 } } });
    const client = await helloed(made, '203.0.113.7');
    for (const id of ['a', 'b', 'c']) subscribe(client, id);
    const refused = await client.until((message) => message.type === 'error');
    expect(refused.at(-1)).toMatchObject({
      type: 'error',
      id: 'c',
      error: { code: 'core.quota_exceeded' },
    });
    await vi.waitFor(() => expect(state.open).toBe(2));
    // The bound is the tenant's: a socket of another address is refused too.
    expect(await made.connect({ 'x-forwarded-for': '203.0.113.8' })).toMatchObject({ status: 429 });
  });

  test('of an anonymous socket count against its address, and another address is not shut out', async () => {
    const state = { open: 0 };
    const made = await started(state);
    const client = await helloed(made, '203.0.113.7');
    // The socket holds one of the 20 slots of its address, so 19 subscriptions fill them.
    for (let index = 0; index < 19; index += 1) subscribe(client, `s${index}`);
    await vi.waitFor(() => expect(state.open).toBe(19));
    subscribe(client, 'over');
    expect((await client.until((message) => message.type === 'error')).at(-1)).toMatchObject({
      type: 'error',
      id: 'over',
      error: { code: 'core.quota_exceeded' },
    });
    const other = await helloed(made, '203.0.113.8');
    subscribe(other, 'mine');
    await vi.waitFor(() => expect(state.open).toBe(20));
  });
});
