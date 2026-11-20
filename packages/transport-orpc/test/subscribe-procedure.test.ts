import { type ApiSurface, deriveSurface, type Invoker, type LiveFrame } from '@keelwerk/core';
import { getEventMeta } from '@orpc/server';
import { describe, expect, test, vi } from 'vitest';
import { subscribeProcedure } from '../src/router/subscribe-procedure.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

/**
 * A promise that resolves to 'late' in a macrotask. Microtasks all run before any macrotask, so
 * when a race against it is won by something else, that thing settled by microtasks alone.
 */
function late(): Promise<'late'> {
  return new Promise<'late'>((resolve) => setImmediate(() => resolve('late')));
}

describe('the iterator of subscribeProcedure', () => {
  const surface: ApiSurface = deriveSurface(
    orpcConformanceApp as never,
    orpcConformanceVersions.head,
  ).surface;
  const action = surface.actions.find((candidate) => candidate.ref === 'loans.loanEvents');

  const invokerOf = (frames: LiveFrame<unknown>[]): Invoker =>
    ({
      subscribe: () => ({
        [Symbol.asyncIterator]: () => {
          let index = 0;
          return {
            next: async () =>
              index < frames.length
                ? { done: false as const, value: frames[index++] as LiveFrame<unknown> }
                : await new Promise<never>(() => undefined),
            return: async () => ({ done: true as const, value: undefined }),
          };
        },
      }),
    }) as unknown as Invoker;
  const contextOf = (invoker: Invoker) =>
    ({
      session: { principal: { kind: 'user' } },
      carrier: { transport: 'http' },
      requestId: 'r1',
      signal: new AbortController().signal,
      invoker,
      surface,
      wire: 'orpc',
      development: false,
      log: { error: () => undefined },
      setCookies: [],
      answer: {},
    }) as never;

  test('cancelling the body returns the invoker’s iterator, after the invocation was aborted', async () => {
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const order: string[] = [];
    let aborted: AbortSignal | undefined;
    const frames: LiveFrame<unknown>[] = [{ control: 'head', state: 'v2.1' as never }];
    const invoker = {
      subscribe: (invocation: { signal: AbortSignal }) => {
        aborted = invocation.signal;
        invocation.signal.addEventListener('abort', () => order.push('aborted'));
        let index = 0;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () =>
              index < frames.length
                ? { done: false as const, value: frames[index++] as LiveFrame<unknown> }
                : await new Promise<never>(() => undefined),
            return: async () => {
              order.push('returned');
              return { done: true as const, value: undefined };
            },
          }),
        };
      },
    } as unknown as Invoker;
    const iterator = await subscribeProcedure(contextOf(invoker), action, {}, undefined, undefined);
    expect(aborted?.aborted).toBe(false);
    await iterator.return?.();
    expect(order).toEqual(['aborted', 'returned']);
  });

  test('an item is { data, id } and its event id is that id', async () => {
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const event = { loanId: '0192a000-0000-7000-8000-000000000001', kind: 'created' };
    const iterator = await subscribeProcedure(
      contextOf(
        invokerOf([
          { control: 'head', state: 'v2.1' as never },
          { event, state: 'v2.2' as never },
          { event },
        ]),
      ),
      action,
      {},
      undefined,
      undefined,
    );
    const head = await iterator.next();
    expect(getEventMeta(head.value as object)).toEqual({ id: 'v2.1' });
    const item = await iterator.next();
    expect(item.value).toEqual({
      data: { loanId: expect.stringMatching(/^loan_/), kind: 'created' },
      id: 'v2.2',
    });
    expect(getEventMeta(item.value as object)).toEqual({ id: 'v2.2' });
    const stateless = await iterator.next();
    expect(stateless.value).toEqual({ data: expect.objectContaining({ kind: 'created' }) });
    expect(Object.keys(stateless.value as object)).toEqual(['data']);
    await iterator.return?.();
  });

  test('a control frame given with a stray data member goes out without it', async () => {
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const iterator = await subscribeProcedure(
      contextOf(
        invokerOf([
          { control: 'head', state: 'v2.1', data: 'stray', extra: 1 } as never,
          { control: 'gap', missed: 3, data: 'stray' } as never,
          { control: 'reset', reason: 'resync', state: 'v2.9', data: 'stray' } as never,
        ]),
      ),
      action,
      {},
      undefined,
      undefined,
    );
    const head = await iterator.next();
    expect(head.value).toEqual({ control: 'head', state: 'v2.1' });
    const gap = await iterator.next();
    expect(gap.value).toEqual({ control: 'gap', missed: 3 });
    expect(getEventMeta(gap.value as object)).toBeUndefined();
    const reset = await iterator.next();
    expect(reset.value).toEqual({ control: 'reset', reason: 'resync', state: 'v2.9' });
    await iterator.return?.();
  });

  test('a reset that has a state carries it as its event id', async () => {
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const iterator = await subscribeProcedure(
      contextOf(
        invokerOf([
          { control: 'head', state: 'v2.1' as never },
          { control: 'reset', reason: 'overflow', state: 'v2.7' as never },
        ]),
      ),
      action,
      {},
      undefined,
      undefined,
    );
    await iterator.next();
    const stated = await iterator.next();
    expect(stated.value).toEqual({ control: 'reset', reason: 'overflow', state: 'v2.7' });
    expect(getEventMeta(stated.value as object)).toEqual({ id: 'v2.7' });
    await iterator.return?.();
  });

  test('a reset without a state, and a gap, carry no event id', async () => {
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const iterator = await subscribeProcedure(
      contextOf(
        invokerOf([
          { control: 'head', state: 'v2.1' as never },
          { control: 'gap', missed: 2 },
          { control: 'reset', reason: 'resync' },
        ]),
      ),
      action,
      {},
      undefined,
      undefined,
    );
    await iterator.next();
    const gap = await iterator.next();
    expect(getEventMeta(gap.value as object)).toBeUndefined();
    const stateless = await iterator.next();
    expect(stateless.value).toEqual({ control: 'reset', reason: 'resync' });
    expect(getEventMeta(stateless.value as object)).toBeUndefined();
    await iterator.return?.();
  });

  describe('a reset is the last frame the transport sends', () => {
    const resets: [string, LiveFrame<unknown>][] = [
      ['with a state', { control: 'reset', reason: 'overflow', state: 'v2.7' as never }],
      ['without a state', { control: 'reset', reason: 'resync' }],
    ];
    const sourceOf = (frames: LiveFrame<unknown>[], failing = false, slow?: Promise<void>) => {
      const seen = { inner: undefined as AbortSignal | undefined, returned: 0 };
      const invoker = {
        subscribe: (invocation: { signal: AbortSignal }) => {
          seen.inner = invocation.signal;
          let index = 0;
          return {
            [Symbol.asyncIterator]: () => ({
              next: async () =>
                index < frames.length
                  ? { done: false as const, value: frames[index++] as LiveFrame<unknown> }
                  : await new Promise<never>(() => undefined),
              return: async () => {
                seen.returned += 1;
                if (slow !== undefined) await slow;
                if (failing) throw new Error('the source cannot return (test)');
                return { done: true as const, value: undefined };
              },
            }),
          };
        },
      } as unknown as Invoker;
      return { seen, invoker };
    };
    const event = { loanId: '0192a000-0000-7000-8000-000000000001', kind: 'created' };

    test.each(resets)(
      'after a reset %s the stream is done and the invocation is released',
      async (_kind, reset) => {
        if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
        const { seen, invoker } = sourceOf([
          { control: 'head', state: 'v2.1' as never },
          reset,
          { event, state: 'v2.8' as never },
        ]);
        const outer = new AbortController();
        const context = { ...(contextOf(invoker) as object), signal: outer.signal } as never;
        const removed = vi.spyOn(outer.signal, 'removeEventListener');
        const iterator = await subscribeProcedure(context, action, {}, undefined, undefined);
        await iterator.next();
        expect(((await iterator.next()).value as { control?: string }).control).toBe('reset');
        expect(seen.inner?.aborted).toBe(true);
        expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(await iterator.next()).toEqual({ done: true, value: undefined });
        expect(seen.returned).toBe(1);
        outer.abort();
        await iterator.return?.();
        expect(seen.returned).toBe(1);
      },
    );

    test('a reset that is the first frame also ends the stream', async () => {
      if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
      const { seen, invoker } = sourceOf([
        { control: 'reset', reason: 'resync' },
        { event, state: 'v2.8' as never },
      ]);
      const iterator = await subscribeProcedure(contextOf(invoker), action, {}, 'v2.1', undefined);
      expect((await iterator.next()).value).toEqual({ control: 'reset', reason: 'resync' });
      expect(seen.inner?.aborted).toBe(true);
      expect(await iterator.next()).toEqual({ done: true, value: undefined });
      expect(seen.returned).toBe(1);
    });

    test('a source whose return fails neither delays nor replaces the reset', async () => {
      if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
      const { seen, invoker } = sourceOf(
        [
          { control: 'head', state: 'v2.1' as never },
          { control: 'reset', reason: 'resync' },
        ],
        true,
      );
      const iterator = await subscribeProcedure(
        contextOf(invoker),
        action,
        {},
        undefined,
        undefined,
      );
      await iterator.next();
      expect((await iterator.next()).value).toEqual({ control: 'reset', reason: 'resync' });
      expect(await iterator.next()).toEqual({ done: true, value: undefined });
      expect(seen.returned).toBe(1);
    });

    test('a slow return of the source does not delay the reset', async () => {
      if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { seen, invoker } = sourceOf(
        [
          { control: 'head', state: 'v2.1' as never },
          { control: 'reset', reason: 'resync' },
        ],
        false,
        gate,
      );
      const iterator = await subscribeProcedure(
        contextOf(invoker),
        action,
        {},
        undefined,
        undefined,
      );
      await iterator.next();
      // The reset wins against a reset that waits for the slow return.
      const reset = await Promise.race([iterator.next(), late()]);
      expect(reset).toEqual({ done: false, value: { control: 'reset', reason: 'resync' } });
      expect(seen.returned).toBe(1);
      const last = iterator.next();
      // The end waits for the slow return while the gate is shut.
      expect(await Promise.race([last, late()])).toBe('late');
      open();
      // The end arrives once the return is open.
      const end = await Promise.race([last, late()]);
      expect(end).toEqual({ done: true, value: undefined });
    });
  });
});
