import type { StoredEvent } from '@keelwerk/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import type { Counted } from './support/counting-meter.ts';
import { countingMeter } from './support/counting-meter.ts';
import { loopApp, selfLoopApp } from './support/loop-module.ts';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions, tenantEventsOf } from './support/reactions-kit.ts';

const maxDepth = 4;
const boundMessage = 'a chain of reactions reached its depth bound and a reaction was not queued';
const vias = [
  'write',
  'inline',
  'invoke',
  'enqueue',
  'timer',
  'process',
  'settle',
  'deadline',
] as const;

/** The reactions the loop refuses at the bound, by the way the chain goes round: an inline pulse and its beat reach three reactions at once. */
const refusedAtBound = {
  write: ['loop.toPulse'],
  inline: ['loop.cycle', 'loop.toBeat', 'loop.toPulse'],
  invoke: ['loop.toPulse'],
  enqueue: ['loop.toPulse'],
  timer: ['loop.toPulse'],
  process: ['loop.toPulse'],
  settle: ['loop.toPulse'],
  deadline: ['loop.toPulse'],
} as const;

const byReaction = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) =>
  String(a.reaction).localeCompare(String(b.reaction));

const lineageOf = (event: StoredEvent) => (event as { lineage?: unknown }).lineage;

describe.each(['memory', 'pglite'] as const)(
  'the depth of a chain of reactions on %s',
  (adapter) => {
    const lines: LoggedLine[] = [];
    const counted: Counted[] = [];
    let loopKit: ReactionsKit;
    let selfKit: ReactionsKit;
    const bound = () => lines.filter((line) => line.message === boundMessage);

    beforeAll(async () => {
      loopKit = await bootReactions({
        adapter,
        app: loopApp,
        maxDepth,
        meter: countingMeter(counted),
        watched: true,
        logger: recordingLogger(lines),
      });
      selfKit = await bootReactions({
        adapter,
        app: selfLoopApp,
        maxDepth,
        meter: countingMeter(counted),
        watched: true,
        logger: recordingLogger(lines),
      });
    }, 120_000);
    afterAll(async () => {
      await loopKit.stop();
      await selfKit.stop();
    });
    beforeEach(() => {
      lines.length = 0;
      counted.length = 0;
      loopKit.spy?.enqueued.splice(0);
      selfKit.spy?.enqueued.splice(0);
      loopKit.spy?.completions.splice(0);
      selfKit.spy?.completions.splice(0);
    });

    const reactionJobsOf = (kit: ReactionsKit) =>
      (kit.spy?.enqueued ?? [])
        .map((one) => one.job)
        .filter((job) => job.queue === 'reactions')
        .map((job) => ({
          action: 'action' in job.run ? job.run.action : '',
          lineage: job.causation.lineage,
        }));
    const deadOf = (kit: ReactionsKit) =>
      (kit.spy?.completions ?? []).filter((one) => one.outcome.kind === 'dead');

    /** Runs the chain to its end: a deadline chain needs the clock to pass each round's deadline. */
    const drive = async (via: (typeof vias)[number]) => {
      if (via !== 'deadline') return loopKit.settle();
      await loopKit.settle();
      for (let round = 0; round < 8; round += 1) {
        await loopKit.advanceTo(loopKit.now().add({ seconds: 2 }));
      }
    };

    test.each(vias)(
      'a two-reaction loop through %s stops at the bound: reaction jobs at depths 1 to 4 with the start event as origin, one log line per refused reaction, nothing dead, the system quiet',
      async (via) => {
        const started = await loopKit.call('acme', 'loop.start', { via });
        expect(started.ok).toBe(true);
        await drive(via);

        const events = (await tenantEventsOf(loopKit, 'acme')).filter((event) =>
          event.type.startsWith('loop.'),
        );
        // The runs of the other cases are in the log too: this run's start is the latest beat of depth 0.
        const first = events
          .filter((event) => event.type === 'loop.beat.created' && lineageOf(event) === undefined)
          .at(-1);
        if (first === undefined) throw new Error('the loop wrote no beat');
        expect(lineageOf(first)).toBeUndefined();

        const jobs = reactionJobsOf(loopKit).filter((job) => job.action !== '');
        const depths = new Set(jobs.map((job) => job.lineage?.depth));
        expect([...depths].sort()).toEqual([1, 2, 3, 4]);
        for (const job of jobs) expect(job.lineage?.origin).toBe(first.eventId);

        const refused = bound();
        expect(refused.map((line) => line.fields.reaction).sort()).toEqual([
          ...refusedAtBound[via],
        ]);
        for (const line of refused) {
          expect(line.level).toBe('warn');
          expect(line.fields).toMatchObject({ origin: first.eventId, depth: maxDepth + 1 });
          expect(Object.keys(line.fields).sort()).toEqual(['depth', 'event', 'origin', 'reaction']);
        }
        expect(deadOf(loopKit)).toEqual([]);
        // The dispatcher's own meter counted one depth_bound per refused reaction, and nothing else.
        expect(counted.map((one) => one.name)).toEqual(
          Array(refused.length).fill('keelwerk.reactions.faults'),
        );
        expect(counted.map((one) => one.value)).toEqual(Array(refused.length).fill(1));
        expect(counted.map((one) => one.attributes).sort(byReaction)).toEqual(
          [...refusedAtBound[via]].sort().map((reaction) => ({ fault: 'depth_bound', reaction })),
        );

        // A continuation keeps the lineage of what settled the effect: the beats it writes carry the depth of the job that requested the probe, never depth 0 again.
        if (via === 'settle' || via === 'deadline') {
          const beats = events.filter((event) => event.type === 'loop.beat.created');
          expect(
            beats
              .slice(-5)
              .map((event) => (lineageOf(event) as { depth: number } | undefined)?.depth),
          ).toEqual([undefined, 1, 2, 3, 4]);
        }

        // Nothing is left to run: another round queues no job and logs nothing.
        const queued = loopKit.spy?.enqueued.length;
        await loopKit.settle();
        expect(loopKit.spy?.enqueued.length).toBe(queued);
        expect(bound()).toHaveLength(refused.length);
      },
    );

    test('an on-all reaction that writes what it receives stops at the bound, and every line names the start event', async () => {
      const started = await selfKit.call('acme', 'selfloop.start', {});
      expect(started.ok).toBe(true);
      await selfKit.settle();
      const ticks = (await tenantEventsOf(selfKit, 'acme')).filter(
        (event) => event.type === 'selfloop.tick.created',
      );
      const first = ticks.at(0);
      if (first === undefined) throw new Error('the loop wrote no tick');
      expect(lineageOf(first)).toBeUndefined();
      expect(
        ticks.map((event) => (lineageOf(event) as { depth: number } | undefined)?.depth),
      ).toEqual([undefined, 1, 2, 3, 4]);
      const refused = bound();
      expect(refused).toHaveLength(1);
      expect(counted.map((one) => [one.name, one.value, one.attributes])).toEqual([
        [
          'keelwerk.reactions.faults',
          1,
          { fault: 'depth_bound', reaction: 'selfloop.echoEveryEvent' },
        ],
      ]);
      for (const line of refused) {
        expect(line.fields).toMatchObject({
          reaction: 'selfloop.echoEveryEvent',
          origin: first.eventId,
          depth: maxDepth + 1,
        });
      }
      // Settling again enqueues nothing more: the chain has ended.
      const queued = selfKit.spy?.enqueued.length;
      await selfKit.settle();
      expect(selfKit.spy?.enqueued.length).toBe(queued);
    });

    test('a command from a caller starts at depth 0: its events carry no lineage', async () => {
      const started = await loopKit.call('acme', 'loop.start', { via: 'write' });
      expect(started.ok).toBe(true);
      await loopKit.settle();
      const events = (await tenantEventsOf(loopKit, 'acme')).filter((event) =>
        event.type.startsWith('loop.'),
      );
      const roots = events.filter((event) => !Object.hasOwn(event, 'lineage'));
      expect(roots.length).toBeGreaterThan(0);
      // Only the start beats have none: every event a reaction job wrote has one.
      expect(new Set(roots.map((event) => event.type))).toEqual(new Set(['loop.beat.created']));
      expect(
        events
          .filter((event) => event.type === 'loop.pulse.created')
          .every((event) => lineageOf(event) !== undefined),
      ).toBe(true);
    });

    test('the events a reaction job writes carry its lineage in the envelope', async () => {
      await loopKit.call('acme', 'loop.start', { via: 'write' });
      await loopKit.settle();
      const events = await tenantEventsOf(loopKit, 'acme');
      // The chain of this run: the start beat of this test is the latest event without lineage.
      const starts = events.filter(
        (event) => event.type === 'loop.beat.created' && lineageOf(event) === undefined,
      );
      const start = starts.at(-1);
      if (start === undefined) throw new Error('the loop wrote no start beat');
      const chain = events.filter(
        (event) => (lineageOf(event) as { origin?: string } | undefined)?.origin === start.eventId,
      );
      expect(chain.map((event) => event.type)).toEqual([
        'loop.pulse.created',
        'loop.beat.created',
        'loop.pulse.created',
        'loop.beat.created',
      ]);
      expect(chain.map((event) => lineageOf(event))).toEqual(
        [1, 2, 3, 4].map((depth) => ({ depth, origin: start.eventId })),
      );
      // The stream of an event reads it back the same.
      const [pulse] = chain;
      const again = await loopKit.runtime.adapter.unit(
        loopKit.runtime.namespace,
        loopKit.scopeOf('acme'),
        (unit) => unit.events.readStream(pulse?.stream ?? { type: '', id: '' }),
        { readOnly: true },
      );
      expect(again.map((event) => lineageOf(event))).toEqual([{ depth: 1, origin: start.eventId }]);
    });
  },
);
