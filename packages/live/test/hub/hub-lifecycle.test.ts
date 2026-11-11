import type { LiveFrame, LiveHubServices, Logger } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import type { Adapter, BoardKit, CardEvent } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';
import { recordingLive } from './support/recording-live.ts';

const events = (frames: readonly LiveFrame<CardEvent>[]): CardEvent[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event] : []));

/** A logger that keeps every line it was given, with the fields bound by `child`. */
function loggerOf(lines: { message: string; fields: Record<string, unknown> }[]): Logger {
  const make = (bound: Record<string, unknown>): Logger => {
    const write = (message: string, fields?: Record<string, unknown>): void => {
      lines.push({ message, fields: { ...bound, ...fields } });
    };
    return {
      debug: write,
      info: write,
      warn: write,
      error: write,
      child: (more: Record<string, unknown>) => make({ ...bound, ...more }),
    } as unknown as Logger;
  };
  return make({});
}

// Each test starts one or two runtimes, on pglite too.
vi.setConfig({ testTimeout: 60_000 });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each(['memory', 'pglite'] as const)(
  'the lifecycle of a live hub on %s',
  (adapter: Adapter) => {
    const kits: BoardKit[] = [];
    const start = async (
      recording: ReturnType<typeof recordingLive>,
      logger?: Logger,
    ): Promise<BoardKit> => {
      const kit = await startBoard(adapter, recording.module, logger);
      kits.push(kit);
      return kit;
    };
    const stopAll = async (): Promise<void> => {
      for (const kit of kits.splice(0)) await kit.stop().catch(() => undefined);
    };

    test('each runtime opens its own hub once with its own services', async () => {
      const recording = recordingLive();
      const lines: { message: string; fields: Record<string, unknown> }[][] = [[], []];
      try {
        await start(recording, loggerOf(lines[0] ?? []));
        expect(recording.opened).toHaveLength(1);
        await start(recording, loggerOf(lines[1] ?? []));
        expect(recording.opened).toHaveLength(2);
        const [first, second] = recording.services as [LiveHubServices, LiveHubServices];
        expect(first).not.toBe(second);
        first.log.warn('probe of the first');
        second.log.warn('probe of the second');
        expect(lines[0]?.some((line) => line.message === 'probe of the first')).toBe(true);
        expect(lines[0]?.some((line) => line.message === 'probe of the second')).toBe(false);
        expect(lines[1]?.some((line) => line.message === 'probe of the second')).toBe(true);
        expect(
          lines[0]?.find((line) => line.message === 'probe of the first')?.fields,
        ).toMatchObject({
          app: 'liveboard',
        });
        expect(typeof first.clock.now().epochMilliseconds).toBe('number');
      } finally {
        await stopAll();
      }
    });

    test('two runtimes of one app never see or wake each other’s subscriptions', async () => {
      const recording = recordingLive({ pollMs: 50 });
      try {
        const a = await start(recording);
        const b = await start(recording);
        const [hubA, hubB] = recording.opened;
        if (hubA === undefined || hubB === undefined) throw new Error('two hubs were opened');
        const inA = a.subscribe(a.acme, people.ada);
        const inB = b.subscribe(b.acme, people.ada);
        await inA.ready();
        await inB.ready();
        expect(hubA.subscriptions()).toHaveLength(1);
        expect(hubB.subscriptions()).toHaveLength(1);
        expect(hubA.subscriptions()[0]).not.toBe(hubB.subscriptions()[0]);
        const made = await a.write<{ id: string }>(a.acme, 'board.card.create', {
          owner: 'ada',
          title: 'only in a',
        });
        await inA.until((frames) => events(frames).some((event) => event.cardId === made.id));
        // Three poll periods later the other runtime's subscriber has heard nothing.
        await pause(200);
        expect(events(inB.frames)).toEqual([]);
        await inA.stop();
        await inB.stop();
      } finally {
        await stopAll();
      }
    });

    test('stop ends every subscription without a frame or an error', async () => {
      const recording = recordingLive();
      try {
        const kit = await start(recording);
        const [hub] = recording.opened;
        if (hub === undefined) throw new Error('a hub was opened');
        for (let at = 0; at < 300; at += 1) {
          await kit.write(kit.acme, 'board.card.create', { owner: 'ada', title: `row ${at}` });
        }
        // A stream from now, and one whose token a later stream resumes from.
        const now = kit.subscribe(kit.acme, people.ada);
        const first = kit.subscribe(kit.acme, people.ada);
        await now.ready();
        await first.ready();
        const made = await kit.write<{ id: string }>(kit.acme, 'board.card.create', {
          owner: 'ada',
          title: 'resumed from here',
        });
        await first.until((frames) => events(frames).some((event) => event.cardId === made.id));
        const token = [...first.frames].reverse().find((frame) => 'state' in frame && frame.state);
        if (token === undefined || !('state' in token) || token.state === undefined) {
          throw new Error('a frame carried a state');
        }
        await first.stop();
        const resumed = kit.subscribe(kit.acme, people.ada, {}, token.state);
        await resumed.ready();
        // A stream from the beginning: 300 rows are queued for it and one frame was pulled.
        const reading = kit.open(kit.acme, people.ada, { from: 'beginning' });
        await reading.next();
        // A stream that is waiting for its next item.
        const waiting = kit.open(kit.acme, people.ada);
        await waiting.next();
        const pending = waiting.next();
        expect(hub.subscriptions().length).toBeGreaterThanOrEqual(4);
        await kit.stop();
        for (const one of [now, resumed]) {
          await one.until(() => one.ended());
          expect(one.failure()).toBeUndefined();
          expect(one.frames.some((frame) => 'control' in frame && frame.control === 'reset')).toBe(
            false,
          );
        }
        await expect(pending).resolves.toEqual({ done: true, value: undefined });
        await expect(reading.next()).resolves.toEqual({ done: true, value: undefined });
        expect(hub.subscriptions()).toHaveLength(0);
      } finally {
        await stopAll();
      }
    });

    test('a closed hub refuses new subscriptions with core.unavailable, and closes once', async () => {
      const recording = recordingLive();
      try {
        const kit = await start(recording);
        const [hub] = recording.opened;
        if (hub === undefined) throw new Error('a hub was opened');
        const live = kit.subscribe(kit.acme, people.ada);
        await live.ready();
        const deadline = AbortSignal.timeout(5000);
        const closing = hub.close(deadline);
        expect(hub.close(deadline)).toBe(closing);
        await closing;
        await live.until(() => live.ended());
        expect(live.failure()).toBeUndefined();
        const refused = kit.subscribe(kit.acme, people.ada);
        await refused.until(() => refused.ended());
        expect(refused.failure()).toMatchObject({
          kind: 'unavailable',
          code: 'core.unavailable',
          message: 'The live hub has stopped.',
        });
      } finally {
        await stopAll();
      }
    });
  },
);
