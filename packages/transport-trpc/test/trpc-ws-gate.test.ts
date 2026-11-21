import { freshName, testPrincipal } from '@keelwerk/testing';
import { afterAll, afterEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { openedTrpcSocket, startTrpcWsRuntime, trpcWsTestClient } from './support/trpc-ws-kit.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const secret = 'sekrit-token-value-0123456789';
const origin = 'https://app.example.test';
const kit = await startTrpcWsRuntime(
  { liveSocket: { revalidateMs: 60_000 } },
  { config: { trpc: { cors: [origin], websocket: true } } },
);
const noSockets = await startTrpcWsRuntime({}, { config: { trpc: { cors: [] } } });
afterAll(async () => {
  await kit.runtime.stop();
  await noSockets.runtime.stop();
});

const held: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(held.splice(0).map((socket) => socket.close()));
});

async function client(over: Parameters<typeof kit.connect>[0] = {}) {
  const socket = openedTrpcSocket(await kit.connect(over));
  held.push(socket);
  return trpcWsTestClient(socket);
}

const principal = (subject: string, over: Parameters<typeof testPrincipal>[1] = {}) => ({
  'x-test-principal': JSON.stringify(testPrincipal(subject, over)),
});

const head = '2026-11-11';

/** The refusal of an upgrade; an upgrade that was accepted is closed when the case ends, however it ends. */
function refusalOf(upgrade: Awaited<ReturnType<typeof kit.connect>>) {
  if (upgrade.kind === 'open') {
    const { socket } = upgrade;
    onTestFinished(() => socket.close());
    throw new Error('the upgrade was accepted');
  }
  return upgrade.response;
}

describe('the keelwerk.trpc.v1 upgrade on the host', () => {
  test('an upgrade to /trpc without the subprotocol is refused core.unsupported before the handshake', async () => {
    const refused = refusalOf(await kit.connect({ protocol: null }));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: 'core.unsupported' } });
  });

  test('a backend without websocket answers 404 before the handshake', async () => {
    const refused = refusalOf(await noSockets.connect());
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: { code: 'core.not_found' } });
  });

  test('a cookie upgrade from a foreign origin or with no origin is refused 403 core.csrf, its own origin opens', async () => {
    const cookie = `__Host-kw-test=user:${freshName('ada')}`;
    for (const headers of [
      { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      { cookie, 'sec-fetch-site': 'cross-site' },
    ]) {
      const refused = await kit.connect({ headers });
      if (refused.kind === 'open') await refused.socket.close();
      expect(refused.kind, JSON.stringify(headers)).toBe('refused');
      if (refused.kind === 'refused') {
        expect(refused.response.status).toBe(403);
        expect(await refused.response.json()).toMatchObject({ error: { code: 'core.csrf' } });
      }
    }
    const own = await client({ headers: { cookie, origin } });
    await own.ping();
  });

  test('a socket that announces connectionParams and sends none closes 4000 hello_timeout after helloTimeoutMs', async () => {
    const ws = await client({ path: '/trpc?connectionParams=1' });
    await kit.advance(9_000);
    await kit.advance(2_000);
    expect(await ws.socket.closed).toEqual({ code: 4000, reason: 'hello_timeout' });
  });

  test('a token in connectionParams that resolves to nobody closes 4401, and its text is in no message, close reason or log line', async () => {
    const ws = await client({ path: '/trpc?connectionParams=1' });
    ws.params({ token: secret, extra: secret });
    const seen: string[] = [];
    try {
      seen.push(JSON.stringify(await ws.next()));
    } catch {
      // The socket closed without a message.
    }
    const closed = await ws.socket.closed;
    seen.push(JSON.stringify(closed));
    expect(closed.code).toBe(4401);
    seen.push(JSON.stringify(kit.lines));
    expect(seen.join('\n')).not.toContain(secret);
  });

  test.each([
    ['whose principal does not expire', undefined],
    ['whose principal expired before the upgrade', { seconds: 5 }],
  ])(
    'a stream ticket in the upgrade URL %s authenticates nothing and is spent',
    async (_case, expiresIn) => {
      const expiresAt = expiresIn === undefined ? undefined : kit.now().add(expiresIn);
      const domain = kit.runtime.domains.acme;
      const issued = await kit.runtime.fetch(
        new Request(`https://${domain}/_keelwerk/v1/invoke`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...principal(freshName('ada'), expiresAt === undefined ? {} : { expiresAt }),
          },
          body: JSON.stringify({ action: 'live.ticket', input: { action: 'loans.loanEvents' } }),
        }),
      );
      const body = (await issued.json()) as { ok: boolean; value: { ticket: string } };
      expect(body.ok, JSON.stringify(body)).toBe(true);
      const { ticket } = body.value;
      // The ticket stays well within its own lifetime: only the principal's expiry differs between the cases.
      await kit.advance(6_000);
      const ws = await client({ path: `/trpc?ticket=${ticket}` });
      await ws.ping();
      ws.call(1, 'subscription', 'loans.loanEvents', { json: {} });
      expect(await ws.next()).toMatchObject({ id: 1, result: { type: 'started' } });
      const answer = await ws.next();
      expect(JSON.stringify(answer)).toContain('core.unauthenticated');
      const again = await kit.runtime.fetch(
        new Request(
          `https://${domain}/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D&ticket=${ticket}`,
        ),
      );
      expect(again.status).toBe(401);
      expect(await again.json()).toMatchObject({ error: { code: 'core.ticket_invalid' } });
    },
  );

  describe('a principal that expires between the upgrade and the first message', () => {
    /** Upgrades as a principal that expires 1 s on, lets 2 s pass, then sends the first message with `apiVersion`, which asks the host to open a session again. */
    async function openedAfterExpiry(expiresIn: Temporal.DurationLike) {
      const expiresAt = kit.now().add(expiresIn);
      const ws = await client({
        path: '/trpc?connectionParams=1',
        headers: principal(freshName('ada'), { expiresAt }),
      });
      await kit.advance(2_000);
      ws.params({ apiVersion: head });
      return ws;
    }

    test('is refused with the code HTTP answers, core.unauthenticated: the socket closes 4401 with it as the reason', async () => {
      const ws = await openedAfterExpiry({ seconds: 1 });
      expect(await ws.socket.closed).toEqual({ code: 4401, reason: 'core.unauthenticated' });
      const http = await kit.runtime.fetch(
        new Request(`https://${kit.runtime.domains.acme}/trpc/library.findByIsbn?input=%7B%7D`, {
          headers: principal(freshName('ada'), { expiresAt: kit.now().subtract({ seconds: 1 }) }),
        }),
      );
      expect(http.status).toBe(401);
      expect(await http.json()).toMatchObject({
        error: { code: 'core.unauthenticated', message: 'The credentials were not accepted.' },
      });
    });

    test('a principal that does not expire opens the same message', async () => {
      const ws = await openedAfterExpiry({ hours: 1 });
      await ws.ping();
      ws.call(1, 'query', 'library.findByIsbn', { json: { isbn: 'x' } });
      expect(await ws.next()).toMatchObject({ id: 1, result: { type: 'data' } });
    });
  });

  test('a revoked session closes the socket 4401 after revalidateMs', async () => {
    const ada = freshName('ada');
    const ws = await client({ headers: principal(ada) });
    await ws.ping();
    kit.runtime.revoke(ada);
    await kit.advance(60_000);
    expect(await ws.socket.closed).toMatchObject({ code: 4401 });
  });

  test('at the maximum duration the socket closes 1000 max_duration', async () => {
    const ws = await client();
    await ws.ping();
    await kit.advance(86_400_000);
    expect(await ws.socket.closed).toEqual({ code: 1000, reason: 'max_duration' });
  });
});
