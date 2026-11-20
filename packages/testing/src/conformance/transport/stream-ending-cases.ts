import { describe, expect, test } from 'vitest';
import type { Caller } from './call.ts';
import type { EventStreamReader } from './event-stream-reader.ts';
import { freshName } from './fresh-name.ts';
import { lendTitles } from './lend-titles.ts';
import type { StreamEndingBounds } from './stream-ending-bounds.ts';
import type { StreamEndingRun } from './stream-ending-run.ts';
import type { StreamFrame } from './stream-frame.ts';
import type { TransportCodec } from './transport-codec.ts';

interface Context {
  open(caller: Caller): Promise<EventStreamReader>;
  stop(): Promise<void>;
}

const waitMs = 30_000;
const settleMs = 10_000;
const day = 86_400_000;
const hour = 3_600_000;

const isItem = (frame: StreamFrame): boolean => frame.event === 'data';

/**
 * The endings of an HTTP stream that the host owns (15.4.5, 16.3.4, 16.3.6), each on a deployment of
 * its own that `start` boots with the bounds the case names, on a pinned clock, so no ending waits
 * on real time and none shares a host: a revoked session within one revalidation interval (a key,
 * and a cookie session that its resolver answers as anonymous), an expired session, the maximum
 * duration, the host's stop. Each case subscribes to `loans.loanTitles` through `codec.subscribe`
 * (skipped without one), as an auditor who reads every loan of the tenant (the cookie case in the
 * role form of the test cookie, `user+auditor:<subject>`), and proves that the stream ended, that a
 * title lent only after the ending is seen reaches the other subscriber (the positive control) and
 * the ended stream not at all, and that the slot is free again (`maxStreams` 2: a third stream is
 * 429 before the ending and 200 after it).
 */
export function streamEndingCases(
  codec: TransportCodec,
  start: (bounds: StreamEndingBounds) => Promise<StreamEndingRun>,
): void {
  const subscribe = codec.subscribe?.bind(codec);
  const skip = subscribe === undefined;

  /** One case on its own deployment; the deployment is stopped exactly once, by the case or at its end. */
  const onDeployment = async (
    bounds: StreamEndingBounds,
    body: (run: StreamEndingRun, ctx: Context) => Promise<void>,
  ): Promise<void> => {
    const run = await start(bounds);
    const readers: EventStreamReader[] = [];
    let stopped = false;
    const ctx: Context = {
      open: async (caller: Caller) => {
        if (subscribe === undefined) throw new Error('The codec has no stream endpoint.');
        const reader = await subscribe(run.target, {
          action: 'loans.loanTitles',
          input: {},
          caller: { roles: ['auditor'], ...caller },
        });
        readers.push(reader);
        return reader;
      },
      stop: async () => {
        stopped = true;
        await run.stop();
      },
    };
    try {
      await body(run, ctx);
    } finally {
      await Promise.all(readers.map((reader) => reader.close().catch(() => undefined)));
      if (!stopped) await run.stop();
    }
  };

  /** Opens a stream of `caller` and reads it until its head. */
  const headed = async (ctx: Context, caller: Caller): Promise<EventStreamReader> => {
    const reader = await ctx.open(caller);
    expect(reader.response.status).toBe(200);
    const frames = await reader.until((frame) => frame.event === 'head', waitMs);
    expect(frames.at(-1)?.event).toBe('head');
    return reader;
  };

  /** Every frame up to the end of the stream; a stream that does not end fails the read. */
  const drained = async (reader: EventStreamReader): Promise<readonly StreamFrame[]> => {
    const frames: StreamFrame[] = [];
    for (;;) {
      const frame = await reader.next(waitMs);
      if (frame === undefined) return frames;
      frames.push(frame);
    }
  };

  /** The frames up to the end of the stream or, when it does not end, up to the first item: a stream that still serves is seen by its item. */
  const drainedToItem = async (reader: EventStreamReader): Promise<readonly StreamFrame[]> => {
    const frames: StreamFrame[] = [];
    for (;;) {
      const frame = await reader.next(waitMs);
      if (frame === undefined) return frames;
      frames.push(frame);
      if (isItem(frame)) return frames;
    }
  };

  const slotStatus = async (ctx: Context, subject: string): Promise<number> => {
    const reader = await ctx.open({ subject });
    const { status } = reader.response;
    await reader.close();
    return status;
  };

  /**
   * Whether the slot of the ended stream is free again within `settleMs` of real time. The host
   * releases the slot as it closes the body, so a free slot is the sign that the ending is enacted;
   * a probe stream that is admitted is closed at once.
   */
  const slotFreed = async (ctx: Context): Promise<boolean> => {
    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline) {
      if ((await slotStatus(ctx, freshName('probe'))) === 200) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  /**
   * The common proof of one ending: the slot of ada's stream is free, so the ending is enacted; only
   * then a title is lent, which must reach bob and never ada (an auditor, entitled to it). A stream
   * that did not end shows itself by that item, and the case fails on it, not on a read timeout.
   */
  const proveEnded = async (
    run: StreamEndingRun,
    ctx: Context,
    ada: EventStreamReader,
    bob: EventStreamReader,
    bobSubject: string,
  ): Promise<void> => {
    await slotFreed(ctx);
    const title = freshName('Dune');
    await lendTitles(run.target, bobSubject, { subject: bobSubject, roles: ['auditor'] }, [title]);
    const ending = await drainedToItem(ada);
    expect(ending.filter(isItem)).toEqual([]);
    const served = await bob.until(isItem, waitMs);
    expect(served.at(-1)).toMatchObject({ event: 'data', data: { control: title } });
    expect(await ada.next(waitMs)).toBeUndefined();
    expect(await slotStatus(ctx, freshName('carol'))).toBe(200);
  };

  describe('the endings of a stream the host owns', () => {
    test.skipIf(skip)(
      'a revoked session ends its stream within one revalidation interval',
      async () => {
        await onDeployment(
          { revalidateMs: 5_000, maxDurationMs: day, maxStreams: 2 },
          async (run, ctx) => {
            const ada = freshName('ada');
            const bob = freshName('bob');
            const adaStream = await headed(ctx, { subject: ada });
            const bobStream = await headed(ctx, { subject: bob });
            expect(await slotStatus(ctx, freshName('carol'))).toBe(429);
            run.target.revoke?.(ada);
            await run.target.advance?.(5_000);
            await proveEnded(run, ctx, adaStream, bobStream, bob);
          },
        );
      },
      120_000,
    );

    test.skipIf(skip)(
      'a revoked cookie session, which its resolver answers as anonymous, ends its stream',
      async () => {
        await onDeployment(
          { revalidateMs: 5_000, maxDurationMs: day, maxStreams: 2 },
          async (run, ctx) => {
            const ada = freshName('ada');
            const bob = freshName('bob');
            const adaStream = await headed(ctx, {
              cookie: `user+auditor:${ada}`,
              fetchSite: 'same-origin',
            });
            const bobStream = await headed(ctx, { subject: bob });
            expect(await slotStatus(ctx, freshName('carol'))).toBe(429);
            run.target.revoke?.(ada);
            await run.target.advance?.(5_000);
            await proveEnded(run, ctx, adaStream, bobStream, bob);
          },
        );
      },
      120_000,
    );

    test.skipIf(skip)(
      'an expired session ends its stream',
      async () => {
        await onDeployment(
          { revalidateMs: hour, maxDurationMs: day, maxStreams: 2 },
          async (run, ctx) => {
            const ada = freshName('ada');
            const bob = freshName('bob');
            const expiresAt = run.clock.now().add({ milliseconds: 10_000 }).toString();
            const adaStream = await headed(ctx, { subject: ada, expiresAt });
            const bobStream = await headed(ctx, { subject: bob });
            expect(await slotStatus(ctx, freshName('carol'))).toBe(429);
            await run.target.advance?.(10_000);
            await proveEnded(run, ctx, adaStream, bobStream, bob);
          },
        );
      },
      120_000,
    );

    test.skipIf(skip)(
      'a stream ends at the maximum duration and only that stream',
      async () => {
        await onDeployment(
          { revalidateMs: hour, maxDurationMs: 30_000, maxStreams: 2 },
          async (run, ctx) => {
            const bob = freshName('bob');
            const adaStream = await headed(ctx, { subject: freshName('ada') });
            await run.target.advance?.(15_000);
            const bobStream = await headed(ctx, { subject: bob });
            expect(await slotStatus(ctx, freshName('carol'))).toBe(429);
            await run.target.advance?.(15_000);
            await proveEnded(run, ctx, adaStream, bobStream, bob);
          },
        );
      },
      120_000,
    );

    test.skipIf(skip)(
      'the host’s stop ends a stream',
      async () => {
        await onDeployment(
          { revalidateMs: hour, maxDurationMs: day, maxStreams: 2 },
          async (_run, ctx) => {
            const adaStream = await headed(ctx, { subject: freshName('ada') });
            const ending = drained(adaStream);
            await ctx.stop();
            expect((await ending).filter(isItem)).toEqual([]);
          },
        );
      },
      120_000,
    );
  });
}
