import { errors, type LiveFrame, type StateToken, versionProjection } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import {
  findTrpcAction,
  mountedTrpc,
  sendTrpc,
  trpcConformanceSurface,
  trpcSession,
  trpcSurfaceWith,
  trpcUuidOf,
} from './support/trpc-kit.ts';
import { messages, sseJsonOf } from './support/trpc-sse-messages.ts';

const head = 'v2.1.1.scope.aaaa' as StateToken;
const next = 'v2.1.2.scope.bbbb' as StateToken;
const frames: readonly LiveFrame<unknown>[] = [
  { control: 'head', state: head },
  { event: { loanId: trpcUuidOf(1), kind: 'created' }, state: next },
];
const open = { accept: 'text/event-stream' };
const resumable = (ref = 'loans.loanEvents') =>
  trpcSurfaceWith(trpcConformanceSurface(), { resumable: true }, ref);

describe('subscriptions over server-sent events', () => {
  test('items are tracked with their state token', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        surfaces: versionProjection(['2026-11-11'], () => resumable()),
        subscribe: async function* () {
          yield* frames;
        },
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const [first, second] = await messages(response, 2);
    expect(first?.id).toBe(head);
    expect(sseJsonOf(first)).toEqual({ control: 'head', state: head });
    expect(second?.id).toBe(next);
    expect(sseJsonOf(second)).toEqual({
      data: { loanId: expect.stringMatching(/^loan_[0-9a-z]{26}$/), kind: 'created' },
      id: next,
    });
    expect(mounted.subscribed[0]?.carrier.transport).toBe('trpc');
  });

  test.each([
    ['the header', { headers: { ...open, 'last-event-id': head }, search: '' }],
    ['the query', { headers: open, search: `lastEventId=${head}` }],
  ])('lastEventId resumes after the token (%s)', async (_name, call) => {
    let resumed: unknown;
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        surfaces: versionProjection(['2026-11-11'], () => resumable()),
        subscribe: async function* (_inv, resume) {
          resumed = resume;
          yield frames[1] as LiveFrame<unknown>;
        },
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', call);
    await messages(response, 1);
    expect(resumed).toEqual({ after: head });
    expect(mounted.subscribed[0]?.input).toBeUndefined();
  });

  test('a non-resumable subscription carries no ids', async () => {
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      { resumable: false },
      'loans.loanEvents',
    );
    const mounted = await mountedTrpc(surface, () => ({ ok: true, value: undefined }), {
      subscribe: async function* () {
        yield* frames;
      },
    });
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
    const events = await messages(response, 2);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.id)).toEqual([undefined, undefined]);
    expect(sseJsonOf(events[0])).toEqual({ control: 'head', state: head });
    expect(sseJsonOf(events[1])).toEqual({
      data: { loanId: expect.stringMatching(/^loan_[0-9a-z]{26}$/), kind: 'created' },
    });
  });

  test('a refused subscription is one error event with data.keelwerk', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        subscribe: () =>
          (async function* (): AsyncGenerator<LiveFrame<unknown>> {
            yield* [];
            throw errors.forbidden('Not yours.');
          })(),
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
    expect(response.status).toBe(200);
    const [only, ...rest] = await messages(response, 3);
    expect(rest).toEqual([]);
    expect(only?.event).toBe('serialized-error');
    expect(sseJsonOf(only)).toMatchObject({
      code: -32003,
      data: { code: 'FORBIDDEN', keelwerk: { kind: 'forbidden', code: 'core.forbidden' } },
    });
  });

  test('a subscription input that does not decode is refused as validation', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        subscribe: async function* () {},
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loan.watch', {
      headers: open,
      search: `input=${encodeURIComponent(JSON.stringify({ json: { from: 5 } }))}`,
    });
    const [only] = await messages(response, 1);
    expect(sseJsonOf(only)).toMatchObject({ data: { keelwerk: { kind: 'validation' } } });
    expect(mounted.subscribed).toEqual([]);
  });

  test('connectionParams in the URL are refused: they are read on the socket only', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        subscribe: async function* () {},
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', {
      headers: open,
      search: `connectionParams=1`,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        json: {
          data: { keelwerk: { kind: 'validation', code: 'core.validation' } },
          message: expect.stringMatching(
            /Keelwerk-Version header.*keelwerk-version query parameter/,
          ),
        },
      },
    });
    expect(mounted.subscribed).toEqual([]);
  });

  test('leaving the stream ends the invocation', async () => {
    let signal: AbortSignal | undefined;
    let finished = false;
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        subscribe: (inv) => {
          signal = inv.signal;
          return (async function* (): AsyncGenerator<LiveFrame<unknown>> {
            try {
              yield frames[0] as LiveFrame<unknown>;
              await new Promise<void>((resolve) =>
                inv.signal.addEventListener('abort', () => resolve(), { once: true }),
              );
            } finally {
              finished = true;
            }
          })();
        },
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
    const reader = readEventStream(response);
    for (;;) {
      const event = await reader.next();
      if (event?.event === 'message') break;
    }
    expect(signal?.aborted).toBe(false);
    await reader.close();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(signal?.aborted).toBe(true);
    await mounted.close();
  });

  test('the older version encodes every item by its own surface', async () => {
    const head = trpcConformanceSurface('2026-11-11');
    const older = trpcConformanceSurface('2026-11-04');
    const event = findTrpcAction(older, 'loans.loanEvents');
    if (event.output.kind !== 'shape') throw new Error('the event is a shape');
    const { kind: _dropped, ...fields } = event.output.fields;
    const legacy = trpcSurfaceWith(
      older,
      { output: { ...event.output, fields } },
      'loans.loanEvents',
    );
    const mounted = await mountedTrpc(head, () => ({ ok: true, value: undefined }), {
      surfaces: versionProjection(['2026-11-04', '2026-11-11'], (version) =>
        version === '2026-11-04' ? legacy : head,
      ),
      subscribe: async function* () {
        yield frames[1] as LiveFrame<unknown>;
      },
    });
    const at = async (apiVersion: string) =>
      sseJsonOf(
        (
          await messages(
            await sendTrpc(mounted.handler, 'loans.loanEvents', {
              headers: open,
              session: trpcSession({ apiVersion }),
            }),
            1,
          )
        )[0],
      );
    expect(await at('2026-11-11')).toMatchObject({ data: { kind: 'created' } });
    expect(await at('2026-11-04')).not.toHaveProperty('data.kind');
    expect(await at('2026-11-04')).toHaveProperty('data.loanId');
  });
});
