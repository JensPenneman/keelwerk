import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import {
  graphqlWsClient,
  openedSocket,
  startWsRuntime,
  tickerQuery,
} from './support/graphql-ws-client.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const secret = 'sekrit-token-value-0123456789';
const kit = await startWsRuntime();
const noSockets = await startWsRuntime({}, { config: { graphql: { cors: [] } } });
afterAll(async () => {
  await kit.runtime.stop();
  await noSockets.runtime.stop();
});

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((socket) => socket.close()));
});

async function client(over: Parameters<typeof kit.connect>[0] = {}) {
  const socket = openedSocket(await kit.connect(over));
  opened.push(socket);
  return graphqlWsClient(socket);
}

describe('graphql-transport-ws on the host', () => {
  test('a socket that sends no connection_init is closed 4408 after helloTimeoutMs', async () => {
    // Removing the first-message wait of serve-registered-socket.ts (the sleepUntil on helloTimeoutMs) leaves the socket open.
    const ws = await client();
    await kit.advance(9_000);
    await kit.advance(2_000);
    expect(await ws.socket.closed).toEqual({
      code: 4408,
      reason: 'Connection initialisation timeout',
    });
  });

  test('a second connection_init closes 4429', async () => {
    const ws = await client();
    await ws.init();
    ws.send({ type: 'connection_init' });
    expect(await ws.socket.closed).toMatchObject({ code: 4429 });
  });

  test('a subscribe before the acknowledgement closes 4401', async () => {
    const ws = await client();
    ws.subscribe('1', tickerQuery);
    expect(await ws.socket.closed).toMatchObject({ code: 4401 });
  });

  test('a query or mutation over the socket is refused core.unsupported', async () => {
    const ws = await client();
    await ws.init();
    ws.subscribe('1', '{ __typename }');
    const answer = await ws.next();
    expect(answer).toMatchObject({ type: 'error', id: '1' });
    const [error] = answer.payload as { extensions: { keelwerk: { code: string } } }[];
    expect(error?.extensions.keelwerk.code).toBe('core.unsupported');
  });

  test('a token in connectionParams is read once, and its text is in no frame, close reason or log line', async () => {
    const seen: string[] = [];
    // A token no resolver knows: the host refuses the connection and closes with the code of the error.
    const ws = await client();
    ws.send({ type: 'connection_init', payload: { token: secret, extra: secret } });
    try {
      seen.push(JSON.stringify(await ws.next()));
    } catch {
      // The socket closed without a frame.
    }
    const closed = await ws.socket.closed;
    seen.push(JSON.stringify(closed));
    expect(closed.code).not.toBe(1006);
    seen.push(JSON.stringify(kit.lines));
    expect(seen.join('\n')).not.toContain(secret);
    // The parameters are read at connection_init only: a later message cannot reach them.
    const other = await client();
    await other.init({ note: 'no credentials here' });
    other.subscribe('1', tickerQuery);
    expect(await other.next()).toMatchObject({ type: 'next', id: '1' });
  });

  test('connectionParams open the session the socket then runs under: a pinned API version answers its deprecation notice', async () => {
    const plain = await client();
    await plain.init();
    plain.subscribe('1', tickerQuery);
    const first = await plain.next();
    expect(JSON.stringify(first)).not.toContain('deprecations');
    const pinned = await client();
    await pinned.init({ apiVersion: '2026-11-04' });
    pinned.subscribe('1', tickerQuery);
    const answer = await pinned.next();
    expect(answer).toMatchObject({
      type: 'next',
      payload: {
        extensions: {
          keelwerk: { deprecations: [{ kind: 'deprecation', apiVersion: '2026-11-04' }] },
        },
      },
    });
  });

  test('a non-string connection parameter closes 4400', async () => {
    for (const params of [{ token: 5 }, { tenant: ['a'] }, { backend: null }, { apiVersion: {} }]) {
      const ws = await client();
      ws.send({ type: 'connection_init', payload: params });
      expect(await ws.socket.closed, JSON.stringify(params)).toEqual({
        code: 4400,
        reason: 'Invalid connection parameters',
      });
    }
  });

  test('a retired API version is refused at the upgrade with the status and code POST /graphql answers', async () => {
    const headers = { 'keelwerk-version': '2026-01-01' };
    const refused = await kit.connect({ headers });
    if (refused.kind !== 'refused') throw new Error('the upgrade was accepted');
    const post = await kit.runtime.fetch(
      new Request(`https://${kit.runtime.domains.acme}/graphql`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      }),
    );
    expect(refused.response.status).toBe(post.status);
    expect(refused.response.status).toBeGreaterThanOrEqual(400);
    // The host answers a retired version before any transport runs: both answers are its envelope.
    const upgradeBody = (await refused.response.json()) as { error?: { code?: string } };
    const postBody = (await post.json()) as { error?: { code?: string } };
    expect(upgradeBody.error?.code).toBe('core.api_version_retired');
    expect(postBody.error?.code).toBe(upgradeBody.error?.code);
  });

  test('a backend without websocket answers 404 before the handshake', async () => {
    const refused = await noSockets.connect();
    if (refused.kind !== 'refused') throw new Error('the upgrade was accepted');
    expect(refused.response.status).toBe(404);
    expect(await refused.response.json()).toMatchObject({ error: { code: 'core.not_found' } });
  });
});
