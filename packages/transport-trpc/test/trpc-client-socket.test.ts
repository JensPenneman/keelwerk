import { freshName } from '@keelwerk/testing';
import { afterAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { trpcClientHost } from './support/trpc-client-host.ts';
import { tokenOf } from './support/with-token-resolver.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const host = await trpcClientHost({ websocket: true });
afterAll(() => host.stop());

const wait = { timeout: 20_000, interval: 10 } as const;

const lend = (client: ReturnType<typeof host.clientOf>) =>
  client.loans.lend.mutate({
    bookTitle: freshName('Dune'),
    dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
  });

describe('@trpc/client over keelwerk.trpc.v1', () => {
  test('@trpc/client subscribes through wsLink with trpcWebSocket: the head and each item arrive tracked as over SSE', async () => {
    const subject = freshName('ada');
    const { client, close } = host.socketClientOf(subject);
    const seen: unknown[] = [];
    const subscription = client.loans.loanEvents.subscribe(
      {},
      { onData: (data) => seen.push(data) },
    );
    try {
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 10_000 });
      const head = seen[0] as { id: string; data: { control: string; state: string } };
      expect(head).toEqual({ id: head.data.state, data: { control: 'head', state: head.id } });
      await lend(host.clientOf(subject));
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(1), { timeout: 10_000 });
      expect(seen[1]).toEqual({
        id: expect.any(String),
        data: { data: { loanId: expect.any(String), kind: 'created' }, id: expect.any(String) },
      });
      const second = seen[1] as { id: string; data: { id: string } };
      expect(second.data.id).toBe(second.id);
    } finally {
      subscription.unsubscribe();
      await close();
    }
  });

  test('over wsLink a query answers and a command is refused core.unsupported, while httpBatchLink runs the same command', async () => {
    const subject = freshName('ada');
    const { client, close } = host.socketClientOf(subject);
    try {
      expect(await client.library.findByIsbn.query({ isbn: freshName('isbn') })).toEqual({});
      const refused = await lend(client).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      const data = (refused as { data?: { keelwerk?: { code?: string } } } | undefined)?.data;
      expect(data?.keelwerk?.code).toBe('core.unsupported');
      expect(await lend(host.clientOf(subject))).toMatchObject({
        loanId: expect.stringMatching(/^loan_[0-9a-z]{26}$/),
      });
    } finally {
      await close();
    }
  });

  test('over wsLink a subscription the caller may not open and one with a malformed lastEventId are errors on their own id, and a following subscription on the same client gets its head', async () => {
    const codeOf = (failure: unknown): string | undefined =>
      (failure as { data?: { keelwerk?: { code?: string } } }).data?.keelwerk?.code;
    type Opened = { readonly head?: unknown; readonly code?: string | undefined };
    type Subscribe = (
      input: unknown,
      handlers: { onData(data: unknown): void; onError(failure: unknown): void },
    ) => { unsubscribe(): void };
    const attempt = (
      client: ReturnType<typeof host.clientOf>,
      path: 'loanEvents' | 'loanTicker',
      input: Record<string, unknown> = {},
    ) =>
      new Promise<Opened>((resolve) => {
        const procedure = client.loans[path] as unknown as { subscribe: Subscribe };
        const subscription = procedure.subscribe(input, {
          onData: (data) => {
            subscription.unsubscribe();
            resolve({ head: data });
          },
          onError: (failure) => resolve({ code: codeOf(failure) }),
        });
      });
    const anonymous = host.socketClientOf(undefined);
    const named = host.socketClientOf(freshName('ada'));
    try {
      expect(await attempt(anonymous.client, 'loanEvents')).toEqual({
        code: 'core.unauthenticated',
      });
      expect(await attempt(anonymous.client, 'loanTicker')).toMatchObject({
        head: { data: { control: 'head' } },
      });
      expect(await attempt(named.client, 'loanEvents', { lastEventId: 'NOT A TOKEN!' })).toEqual({
        code: 'core.malformed_request',
      });
      expect(await attempt(named.client, 'loanEvents')).toMatchObject({
        head: { data: { control: 'head' } },
      });
    } finally {
      await anonymous.close();
      await named.close();
    }
  });

  test('over wsLink with connectionParams, as a browser sends them: the token is the only credential, a query and a subscription run as its user, and a refused token closes the socket 4401 which the client sees', async () => {
    // Every wait below is on loopback with the host in this process: a run needs a few tens of milliseconds
    // for each (the 10 s bound is about 100 times that, and ends the case with its message instead of the
    // test's 60 s); a wait that ends at its bound has found a real fault, not a slow machine.
    const subject = freshName('ada');
    const trusted = host.tokenSocketClientOf(tokenOf(subject));
    onTestFinished(() => trusted.close());
    const seen: unknown[] = [];
    const subscription = trusted.client.loans.loanEvents.subscribe(
      {},
      { onData: (data) => seen.push(data) },
    );
    onTestFinished(() => subscription.unsubscribe());
    // The head is for a signed-in user only: the upgrade carried no credentials, so the token opened it.
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(await trusted.client.library.findByIsbn.query({ isbn: freshName('isbn') })).toEqual({});
    await lend(host.clientOf(subject));
    await vi.waitFor(() => expect(JSON.stringify(seen)).toContain('"loanId"'), { timeout: 10_000 });
    // A token that resolves to nobody: the host closes 4401 after the first message, the query fails with it.
    const closes: number[] = [];
    const refused = host.tokenSocketClientOf('nobody', { onClose: (code) => closes.push(code) });
    onTestFinished(() => refused.close());
    await expect(
      refused.client.library.findByIsbn.query({ isbn: freshName('isbn') }),
    ).rejects.toThrow();
    await vi.waitFor(() => expect(closes).toContain(4401), { timeout: 10_000 });
  });

  test("an attempt refused by the shut gate is an answer of the server: its close reaches a listener added after tRPC's client adds its own", async () => {
    const Gated = host.gatedWebSocket({ open: false });
    const socket = new Gated(host.socketUrl, 'keelwerk.trpc.v1');
    const failed = Promise.withResolvers<Event>();
    // tRPC's client attaches its listeners two microtasks after it made the socket; a refusal that came
    // sooner (a blocked port is refused before any connection) would never reach them.
    await Promise.resolve();
    await Promise.resolve();
    socket.addEventListener('close', failed.resolve);
    // A refusal by the server comes in a later turn of the event loop and is certain to come.
    expect((await failed.promise).type).toBe('close');
  });

  test('after the host ends the socket at max_duration the client resubscribes with the last id and an item written meanwhile arrives once', async () => {
    const subject = freshName('ada');
    const gate = { open: true };
    let closes = 0;
    let lent = false;
    const opens: boolean[] = [];
    const { client, close } = host.socketClientOf(subject, () => 20, {
      gate,
      onOpen: () => opens.push(lent),
      onClose: () => {
        closes += 1;
      },
    });
    const seen: unknown[] = [];
    const subscription = client.loans.loanEvents.subscribe(
      {},
      { onData: (data) => seen.push(data) },
    );
    const itemsOf = () => seen.filter((entry) => JSON.stringify(entry).includes('"loanId"'));
    try {
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), wait);
      // The host ends the socket at its maximum duration; the client may reconnect only after the item is written.
      gate.open = false;
      await host.advance(86_400_000);
      await vi.waitFor(() => expect(closes).toBeGreaterThan(0), wait);
      const written = await lend(host.clientOf(subject));
      lent = true;
      gate.open = true;
      await vi.waitFor(() => {
        if (itemsOf().length !== 1) {
          throw new Error(
            `The resumed item is missing: ${JSON.stringify({ opens, closes, seen: seen.length })}.`,
          );
        }
      }, wait);
      // The second open came after the item was written, so the item can only come from the resume.
      expect(opens).toEqual([false, true]);
      // A second loan arrives after the first: an ordering barrier, so a duplicate would show before it.
      await lend(host.clientOf(subject));
      await vi.waitFor(() => expect(itemsOf()).toHaveLength(2), wait);
      const first = JSON.stringify(itemsOf()[0]);
      expect(itemsOf().filter((entry) => JSON.stringify(entry) === first)).toHaveLength(1);
      expect(first).toContain((written as { loanId: string }).loanId);
    } finally {
      subscription.unsubscribe();
      await close();
    }
  });
});
