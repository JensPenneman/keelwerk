import { freshName } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { trpcClientCalls } from './support/trpc-client-calls.ts';
import { trpcClientHost } from './support/trpc-client-host.ts';

const host = await trpcClientHost();
afterAll(() => host.stop());
const { url, hostFetch, clientOf, clientWith } = host;

describe('@trpc/client against the host', () => {
  test('@trpc/client calls a query, a command and a subscription through the host', async () => {
    const subject = freshName('ada');
    const client = clientOf(subject);
    const seen: unknown[] = [];
    const subscription = client.loans.loanEvents.subscribe(
      {},
      { onData: (data) => seen.push(data) },
    );
    try {
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 10_000 });
      const head = seen[0] as { id: string; data: { control: string; state: string } };
      expect(head).toEqual({ id: head.data.state, data: { control: 'head', state: head.id } });
      const lent = await client.loans.lend.mutate({
        bookTitle: freshName('Dune'),
        dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
      });
      expect(lent).toMatchObject({ loanId: expect.stringMatching(/^loan_[0-9a-z]{26}$/) });
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(1), { timeout: 10_000 });
      // A tracked item: tRPC's wrapper with the state as id, around the contract's item.
      expect(seen[1]).toEqual({
        id: expect.any(String),
        data: { data: { loanId: expect.any(String), kind: 'created' }, id: expect.any(String) },
      });
      const second = seen[1] as { id: string; data: { id: string } };
      expect(second.data.id).toBe(second.id);
      const found = await client.library.findByIsbn.query({ isbn: freshName('isbn') });
      expect(found).toEqual({});
    } finally {
      subscription.unsubscribe();
    }
    expect(await trpcClientCalls(clientOf(subject))).toMatchObject({ found: {} });
  });

  test('an either command with Prefer answers the receipt', async () => {
    const client = clientOf(freshName('ada'), { prefer: 'respond-async' });
    const answer = await client.loans.lend.mutate({
      bookTitle: freshName('Emma'),
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect(answer).toEqual({ commandId: expect.any(String), status: 'accepted' });
  });

  test('a stream gives its slot back when the client leaves, so a stream opens again at the limit', async () => {
    const fetchWith = hostFetch(freshName('ada'), { accept: 'text/event-stream' });
    const open = () => fetchWith(`${url}/loans.loanEvents`);
    const first = await open();
    const second = await open();
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await open()).status).toBe(429);
    await first.body?.cancel();
    await vi.waitFor(
      async () => {
        const again = await open();
        await again.body?.cancel();
        expect(again.status).toBe(200);
      },
      { timeout: 10_000 },
    );
    await second.body?.cancel();
  });
});

/** A client of one principal whose stream connection a test can cut, and whose next connection it can hold back. */
function cuttable(subject: string) {
  const base = hostFetch(subject);
  const resumedFrom: (string | null)[] = [];
  let cutter: (() => void) | undefined;
  let gate: Promise<void> = Promise.resolve();
  const fetchWith = async (input: string | URL | Request, init?: RequestInit | undefined) => {
    await gate;
    const request = new Request(input, init);
    resumedFrom.push(request.headers.get('last-event-id'));
    const response = await base(request);
    const reader = response.body?.getReader();
    if (reader === undefined) return response;
    let outer: ReadableStreamDefaultController<Uint8Array> | undefined;
    cutter = () => {
      void reader.cancel().catch(() => undefined);
      outer?.error(new Error('the connection was cut'));
    };
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        outer = controller;
      },
      pull: async (controller) => {
        const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return {
    client: clientWith(fetchWith as never),
    resumedFrom,
    /** Cuts the open connection and holds the next one back until `release` is called. */
    cutAndHold: (): (() => void) => {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      cutter?.();
      return release;
    },
  };
}

/** What `onData` receives, unwrapped as the README recipe says: tRPC's tracked wrapper once, then the contract frame. */
function frameOf(value: unknown): { id?: string; frame: Record<string, unknown> } {
  const wrapped = (value as { id?: unknown }).id;
  if (typeof wrapped === 'string') {
    return { id: wrapped, frame: (value as { data: Record<string, unknown> }).data };
  }
  return { frame: value as Record<string, unknown> };
}

const lend = (client: ReturnType<typeof clientOf>) =>
  client.loans.lend.mutate({
    bookTitle: freshName('Dune'),
    dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
  });

describe('the resume of a subscription across a head (tRPC tracks every frame with a state)', () => {
  test('a client cut off after its head, with nothing before it, gets what was written meanwhile exactly once', async () => {
    const subject = freshName('ada');
    const { client, resumedFrom, cutAndHold } = cuttable(subject);
    const seen: ReturnType<typeof frameOf>[] = [];
    const subscription = client.loans.loanEvents.subscribe(
      {},
      { onData: (data) => seen.push(frameOf(data)) },
    );
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 10_000 });
      const head = seen[0];
      expect(head?.frame).toMatchObject({ control: 'head' });
      expect(head?.id).toBe(head?.frame.state);
      const items = () => seen.filter((entry) => 'data' in entry.frame);
      const release = cutAndHold();
      await lend(clientOf(subject));
      release();
      await vi.waitFor(() => expect(items()).toHaveLength(1), { timeout: 10_000 });
      await lend(clientOf(subject));
      await vi.waitFor(() => expect(items()).toHaveLength(2), { timeout: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(items()).toHaveLength(2);
      // Each connection ends its start with a head: the second one comes after the item written meanwhile.
      expect(seen.map((entry) => ('data' in entry.frame ? 'item' : entry.frame.control))).toEqual([
        'head',
        'item',
        'head',
        'item',
      ]);
      expect(resumedFrom[0]).toBeNull();
      expect(resumedFrom[1]).toBe(head?.id);
    } finally {
      subscription.unsubscribe();
    }
  }, 30_000);

  test('a replay that ends in a head is not replayed again by a reconnect before the first live item', async () => {
    const subject = freshName('ada');
    const first = clientOf(subject);
    const before: ReturnType<typeof frameOf>[] = [];
    const watch = first.loans.loanEvents.subscribe(
      {},
      { onData: (data) => before.push(frameOf(data)) },
    );
    let token: string | undefined;
    try {
      await vi.waitFor(() => expect(before).toHaveLength(1), { timeout: 10_000 });
      await lend(clientOf(subject));
      await vi.waitFor(() => expect(before).toHaveLength(2), { timeout: 10_000 });
      token = before[1]?.id;
    } finally {
      watch.unsubscribe();
    }
    expect(token).toEqual(expect.any(String));
    // Two items are written while the client is away; a resume replays them, without a state.
    await lend(clientOf(subject));
    await lend(clientOf(subject));
    const { client, resumedFrom, cutAndHold } = cuttable(subject);
    const seen: ReturnType<typeof frameOf>[] = [];
    const subscription = client.loans.loanEvents.subscribe(
      { lastEventId: token ?? null },
      { onData: (data) => seen.push(frameOf(data)) },
    );
    try {
      await vi.waitFor(
        () => expect(seen.some((entry) => entry.frame.control === 'head')).toBe(true),
        {
          timeout: 10_000,
        },
      );
      const head = seen.find((entry) => entry.frame.control === 'head');
      expect(seen.filter((entry) => 'data' in entry.frame)).toHaveLength(2);
      const release = cutAndHold();
      release();
      await lend(clientOf(subject));
      await vi.waitFor(
        () => expect(seen.filter((entry) => 'data' in entry.frame)).toHaveLength(3),
        { timeout: 10_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(seen.filter((entry) => 'data' in entry.frame)).toHaveLength(3);
      expect(resumedFrom[1]).toBe(head?.id);
    } finally {
      subscription.unsubscribe();
    }
  }, 30_000);
});
