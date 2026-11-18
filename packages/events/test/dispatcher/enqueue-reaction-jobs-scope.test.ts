import type { JobQueue, JobSpec, Logger, Meter, Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { enqueueReactionJobs } from '../../src/dispatcher/enqueue-reaction-jobs.ts';
import { dispatchRegistry, eventOf, reactionKeys } from './support/dispatch-registry.ts';

const registry = dispatchRegistry();
const now = Temporal.Instant.from('2026-03-01T08:00:01Z');
const build = { id: 'build-1', revision: 1 };
const origin = '0197a1c2-7b3e-7c11-9a55-aaaaaaaaaaaa';
const maxDepth = 4;
const keySecret = new Uint8Array(32).fill(9);

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
    keySecret,
    log,
    maxDepth: bound,
    meter,
    build,
    now,
  }).then((count) => ({ count, specs, warnings, counted }));
}
const actionsOf = (specs: readonly JobSpec[]) =>
  specs.map((spec) => ('action' in spec.run ? spec.run.action : '')).sort();

const deployment = { level: 'deployment' } as const;
const backend = {
  level: 'backend',
  backendId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01',
} as const;

describe('the scope of the events the reaction dispatcher answers', () => {
  test('an event of the deployment gets no job for any reaction, the on-all one included, and nothing is logged or counted', async () => {
    reactionKeys.seen = 0;
    const event = eventOf('trace.note.created', { scope: deployment });
    const { count, specs, warnings, counted } = await run([event]);
    expect(count).toBe(0);
    expect(specs).toEqual([]);
    expect(warnings).toEqual([]);
    expect(counted).toEqual([]);
    expect(reactionKeys.seen).toBe(0);
  });

  test('an event of the deployment beyond the depth bound logs no bound line', async () => {
    const event = eventOf('trace.note.created', {
      scope: deployment,
      lineage: { depth: maxDepth, origin },
    });
    const { count, warnings, counted } = await run([event]);
    expect(count).toBe(0);
    expect(warnings).toEqual([]);
    expect(counted).toEqual([]);
  });

  test('an event of a backend gets the jobs of every reaction that listens to it', async () => {
    const event = eventOf('trace.note.created', { scope: backend });
    const { count, specs } = await run([event]);
    expect(count).toBe(3);
    expect(actionsOf(specs)).toEqual(listening);
    for (const spec of specs) expect(spec.scope).toEqual(backend);
  });

  test('in a batch of a deployment event between two tenant events only the tenant events get jobs', async () => {
    const { count, specs } = await run([
      eventOf('trace.note.created'),
      eventOf('trace.note.created', { scope: deployment }),
      eventOf('trace.note.created'),
    ]);
    expect(count).toBe(6);
    expect(specs.map((spec) => spec.scope.level)).toEqual(Array(6).fill('tenant'));
  });
});
