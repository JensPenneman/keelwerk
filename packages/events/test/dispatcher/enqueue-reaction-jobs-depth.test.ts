import type { JobQueue, JobSpec, Logger, Meter, Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { enqueueReactionJobs } from '../../src/dispatcher/enqueue-reaction-jobs.ts';
import { dispatchRegistry, eventOf, reactionKeys } from './support/dispatch-registry.ts';

const registry = dispatchRegistry();
const now = Temporal.Instant.from('2026-03-01T08:00:01Z');
const build = { id: 'build-1', revision: 1 };
const origin = '0197a1c2-7b3e-7c11-9a55-aaaaaaaaaaaa';
const maxDepth = 4;

/** Three async reactions listen to `trace.note.created`: `plain`, `ordered` and `every`. */
const listening = ['trace.every', 'trace.ordered', 'trace.plain'];

function run(events: Parameters<typeof enqueueReactionJobs>[0]['events'], bound = maxDepth) {
  const specs: JobSpec[] = [];
  const queue = {
    enqueue: (spec: JobSpec) => {
      specs.push(spec);
      return Promise.resolve(String(specs.length));
    },
  } as unknown as JobQueue;
  const unit = {
    rows: {
      find: () => Promise.resolve({ rows: [] }),
      findOne: () => Promise.resolve(undefined),
    },
    scope: events[0]?.scope,
    namespace: { id: 'ns-1' },
  } as unknown as Unit;
  const warnings: { message: string; fields: unknown }[] = [];
  const log = {
    warn: (message: string, fields: unknown) => warnings.push({ message, fields }),
  } as unknown as Logger;
  const counted: unknown[] = [];
  const meter = {
    createCounter: (name: string) => ({
      add: (value: number, attributes: unknown) => counted.push([name, value, attributes]),
    }),
  } as unknown as Meter;
  return enqueueReactionJobs({
    unit,
    registry,
    events,
    queue,
    log,
    maxDepth: bound,
    meter,
    build,
    now,
  }).then((count) => ({ count, specs, warnings, counted }));
}
const actionsOf = (specs: readonly JobSpec[]) =>
  specs.map((spec) => ('action' in spec.run ? spec.run.action : '')).sort();

describe('the depth bound of the reaction dispatcher', () => {
  test('an event at depth maxDepth - 1 gets jobs at maxDepth with its origin', async () => {
    const event = eventOf('trace.note.created', { lineage: { depth: maxDepth - 1, origin } });
    const { count, specs, warnings, counted } = await run([event]);
    expect(count).toBe(3);
    expect(actionsOf(specs)).toEqual(listening);
    for (const spec of specs) {
      expect(spec.causation.lineage).toEqual({ depth: maxDepth, origin });
    }
    expect(warnings).toEqual([]);
    expect(counted).toEqual([]);
  });

  test('an event at maxDepth queues nothing for any reaction, logs one line per reaction with origin and reaction id, counts depth_bound once each, and computes no key', async () => {
    reactionKeys.seen = 0;
    const event = eventOf('trace.note.created', { lineage: { depth: maxDepth, origin } });
    const { count, specs, warnings, counted } = await run([event]);
    expect(count).toBe(0);
    expect(specs).toEqual([]);
    expect(reactionKeys.seen).toBe(0);
    expect(warnings).toHaveLength(3);
    expect(warnings.map((entry) => entry.message)).toEqual(
      Array(3).fill('a chain of reactions reached its depth bound and a reaction was not queued'),
    );
    const fields = warnings.map((entry) => entry.fields as Record<string, unknown>);
    expect(fields.map((entry) => entry.reaction).sort()).toEqual(listening);
    for (const entry of fields) {
      expect(entry).toMatchObject({ origin, event: event.eventId, depth: maxDepth + 1 });
      expect(Object.keys(entry).sort()).toEqual(['depth', 'event', 'origin', 'reaction']);
    }
    expect(counted).toHaveLength(3);
    expect(counted.map((entry) => (entry as unknown[])[0])).toEqual(
      Array(3).fill('keelwerk.reactions.faults'),
    );
    expect(
      counted.map((entry) => (entry as [string, number, Record<string, string>])[2].fault),
    ).toEqual(Array(3).fill('depth_bound'));
    expect(
      counted
        .map((entry) => (entry as [string, number, Record<string, string>])[2].reaction)
        .sort(),
    ).toEqual(listening);
  });

  test('the other events of the batch are dispatched', async () => {
    const deep = eventOf('trace.note.created', { lineage: { depth: maxDepth, origin } });
    const fresh = eventOf('trace.note.created');
    const { specs, warnings } = await run([deep, fresh]);
    expect(actionsOf(specs)).toEqual(listening);
    expect(
      specs.every(
        (spec) => (spec.run as { input: { event: string } }).input.event === fresh.eventId,
      ),
    ).toBe(true);
    expect(warnings).toHaveLength(3);
  });

  test('an event without lineage, or with a malformed one, starts at depth 1', async () => {
    const plain = eventOf('trace.note.created');
    const broken = eventOf('trace.note.created', {
      lineage: { depth: 0, origin: '' } as never,
    });
    const { specs } = await run([plain, broken]);
    expect(specs).toHaveLength(6);
    const lineages = specs.map((spec) => spec.causation.lineage);
    expect(lineages.slice(0, 3).every((entry) => entry?.depth === 1)).toBe(true);
    expect(lineages.every((entry) => entry?.depth === 1)).toBe(true);
    const origins = new Set(lineages.map((entry) => entry?.origin));
    expect(origins).toEqual(new Set([plain.eventId, broken.eventId]));
  });

  test('a chain at the largest allowed bound is read back at its depth, and the next job is refused: it never starts again at depth 0', async () => {
    const greatest = 2_147_483_646;
    const below = eventOf('trace.note.created', { lineage: { depth: greatest - 1, origin } });
    const queued = await run([below], greatest);
    expect(queued.count).toBe(3);
    for (const spec of queued.specs) {
      expect(spec.causation.lineage).toEqual({ depth: greatest, origin });
      // Below 2^31, so the stored lineage reads back as itself and not as a malformed one (depth 0: `reaction-lineage-of.test.ts` in core).
      expect(spec.causation.lineage?.depth).toBeLessThan(2 ** 31);
    }
    const at = eventOf('trace.note.created', { lineage: { depth: greatest, origin } });
    const refused = await run([at], greatest);
    expect(refused.count).toBe(0);
    expect(refused.specs).toEqual([]);
    expect(refused.counted).toHaveLength(3);
  });
});
