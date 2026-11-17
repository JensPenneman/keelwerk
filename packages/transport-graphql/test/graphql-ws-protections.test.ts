import { freshName } from '@keelwerk/testing';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import {
  graphqlWsClient,
  loanEventsQuery,
  openedSocket,
  startWsRuntime,
  tickerQuery,
} from './support/graphql-ws-client.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// The protections are the host's, shared with keelwerk.live.v1: each test below names the line of the
// shared code whose removal it fails on.
const kit = await startWsRuntime({ liveSocket: { maxSubscriptionsPerSocket: 2 } });
const { bounds } = kit.runtime;
const slow = await startWsRuntime({ liveSocket: { revalidateMs: 10_000_000 } });
afterAll(async () => {
  await kit.runtime.stop();
  await slow.runtime.stop();
});

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((socket) => socket.close()));
});

async function client(over: Parameters<typeof kit.connect>[0] = {}) {
  const upgrade = await kit.connect(over);
  const socket = openedSocket(upgrade);
  open.push(socket);
  return graphqlWsClient(socket);
}

const principal = (subject: string) => ({
  'x-test-principal': JSON.stringify({ subject, roles: [], claims: {} }),
});

describe('the host protections hold over graphql-transport-ws', () => {
  test('a cross-site page cannot open graphql-ws with the user’s cookie; its own origin can', async () => {
    // Remove the `isStreamRequest(...)` argument of the originCheck call in serve-request.ts: the foreign origin is let in.
    const ada = freshName('ada');
    const cookie = `__Host-kw-test=user:${ada}`;
    const refused = await kit.connect({
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    if (refused.kind === 'open') await refused.socket.close();
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') {
      expect(refused.response.status).toBe(403);
      expect(await refused.response.json()).toMatchObject({ error: { code: 'core.csrf' } });
    }
    const own = await client({
      headers: { cookie, origin: `https://${kit.runtime.domains.acme}` },
    });
    await own.init();
  });

  test('anonymous graphql-ws sockets are capped per address', async () => {
    // Remove `host.limits.take` in accept-live-socket.ts: the next socket of the address is let in.
    const address = '203.0.113.201';
    for (let index = 0; index < bounds.maxStreamsPerPrincipal; index += 1) {
      const ws = await client({ options: { remoteAddress: address } });
      await ws.init();
    }
    const over = await kit.connect({ options: { remoteAddress: address } });
    if (over.kind === 'open') await over.socket.close();
    expect(over.kind).toBe('refused');
    if (over.kind === 'refused') {
      expect(over.response.status).toBe(429);
      expect(await over.response.json()).toMatchObject({ error: { code: 'core.quota_exceeded' } });
    }
    const other = await client({ options: { remoteAddress: '203.0.113.202' } });
    await other.init();
  });

  test('subscriptions past maxSubscriptionsPerSocket, and an anonymous address past its bucket, are refused core.quota_exceeded', async () => {
    // Remove the `takeSocketSubscription(state, id)` call in socket-session-of.ts: no subscription is ever refused.
    const refusedWith = async (ws: Awaited<ReturnType<typeof client>>, id: string) => {
      ws.subscribe(id, tickerQuery);
      const answer = await ws.next();
      if (answer.type !== 'error') return answer.type;
      const [error] = answer.payload as { extensions: { keelwerk: { code: string } } }[];
      return error?.extensions.keelwerk.code;
    };
    const ws = await client({ options: { remoteAddress: '203.0.113.211' } });
    await ws.init();
    expect(await refusedWith(ws, 'a')).toBe('next');
    expect(await refusedWith(ws, 'b')).toBe('next');
    expect(await refusedWith(ws, 'c')).toBe('core.quota_exceeded');
    // An id that is open is a protocol violation: the library closes 4409.
    ws.subscribe('a', tickerQuery);
    expect(await ws.socket.closed).toMatchObject({ code: 4409 });
    // The address bucket: sockets of one address fill it, so a subscription of the next socket is refused.
    const address = '203.0.113.212';
    const holders = [];
    for (let index = 0; index < bounds.maxStreamsPerPrincipal; index += 1) {
      const held = await client({ options: { remoteAddress: address } });
      await held.init();
      holders.push(held);
    }
    expect(await refusedWith(holders[0] ?? ws, 'x')).toBe('core.quota_exceeded');
  });

  test('a subscription after the session was revoked is refused and the socket closes 4401', async () => {
    // Remove the `void context.socket?.check()` call in subscribe-resolver.ts: the stream ends with its error and the socket stays open.
    // The host's own periodic check is far away here, so only the subscription's failure can close the socket.
    const ada = freshName('ada');
    const upgrade = await slow.connect({ headers: principal(ada) });
    const socket = openedSocket(upgrade);
    open.push(socket);
    const ws = graphqlWsClient(socket);
    await ws.init();
    ws.subscribe('1', loanEventsQuery);
    expect(await ws.next()).toMatchObject({ type: 'next', id: '1' });
    slow.runtime.revoke(ada);
    // The hub counts 60 s of the runtime's clock from the first of its own ticks (real time) that sees
    // the subscription, so the clock moves again until the socket is seen closed.
    let closed: { code: number; reason: string } | undefined;
    void ws.socket.closed.then((result) => {
      closed = result;
    });
    await vi.waitFor(
      async () => {
        await slow.advance(61_000);
        expect(closed).toBeDefined();
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(closed).toMatchObject({ code: 4401 });
  });

  test('a revoked session closes the socket 4401 after revalidateMs', async () => {
    // Remove the `keepSocketSession` call in socket-session-of.ts: nothing checks the session again.
    const ada = freshName('ada');
    const ws = await client({ headers: principal(ada) });
    await ws.init();
    kit.runtime.revoke(ada);
    await kit.advance(60_000);
    expect(await ws.socket.closed).toMatchObject({ code: 4401 });
  });

  test('at the maximum duration the socket closes 1000 max_duration', async () => {
    // Remove the deadline wait (the sleepUntil on state.deadline) in serve-registered-socket.ts.
    const ws = await client();
    await ws.init();
    await kit.advance(86_400_000);
    expect(await ws.socket.closed).toEqual({ code: 1000, reason: 'max_duration' });
  });

  test('a socket that answers no ping is terminated after pongTimeoutMs', async () => {
    // Remove the `keepSocketAlive(state)` call in socket-session-of.ts: no ping is sent and the socket lives on.
    const ws = await client({ options: { answerPings: false } });
    await ws.init();
    await kit.advance(30_000);
    await kit.advance(10_000);
    expect(await ws.socket.closed).toMatchObject({ code: 1006 });
  });
});
