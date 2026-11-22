import { describe, expect, test } from 'vitest';
import { reenqueueUnsettledEffects } from './reenqueue-unsettled-effects.ts';

const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const backendId = '0192f3a0-0000-7000-8000-0000000000b1';
const now = Temporal.Instant.from('2026-11-17T10:00:00Z');

const row = (id: string, type: string, over: Record<string, unknown> = {}) => ({
  id,
  type,
  commandId: `command-${id}`,
  status: 'requested',
  performer: 'executor',
  input: { to: 'ada' },
  ...over,
});

function setup(
  rows: readonly Record<string, unknown>[],
  failOn?: string,
  options: {
    /** Queue and key of the jobs that are alive in the restored queue, running ones included. */
    readonly alive?: readonly (readonly [string, string])[];
    /** The `requested` event of an effect, by effect id. */
    readonly requested?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const enqueued: Record<string, unknown>[] = [];
  const warned: {
    readonly message: string;
    readonly fields: Record<string, unknown> | undefined;
  }[] = [];
  const conditions: unknown[] = [];
  /** The opening of each unit; a cache from `cacheOf(events)` adds its asks, so the order shows. */
  const events: string[] = [];
  const unit = {
    rows: {
      find: async (
        _entity: unknown,
        query: { where: unknown; page: { first: number; after?: string } },
      ) => {
        conditions.push(query.where);
        const ordered = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
        const from =
          query.page.after === undefined
            ? 0
            : ordered.findIndex((r) => r.id === query.page.after) + 1;
        const page = ordered.slice(from, from + query.page.first);
        return {
          rows: page,
          pageInfo: {
            hasNextPage: from + page.length < ordered.length,
            endCursor: page.at(-1)?.id ?? null,
          },
        };
      },
    },
    events: {
      readStream: async (stream: { id: string }) => {
        const found = options.requested?.[stream.id];
        return found === undefined ? [] : [found];
      },
    },
    jobs: {
      keyed: async (queue: string, key: string) =>
        (options.alive ?? []).some(([q, k]) => q === queue && k === key),
      enqueue: async (job: Record<string, unknown>) => {
        if (failOn !== undefined && (job.run as { effect: string }).effect === failOn) {
          throw new Error('the queue is down');
        }
        enqueued.push(job);
      },
    },
  };
  const scope = { level: 'tenant', backendId, tenantId } as const;
  const input = {
    connected: {
      build: { id: 'build-1', revision: 1 },
      log: {
        warn: (message: string, fields?: Record<string, unknown>) =>
          warned.push({ message, fields }),
      },
    },
    target: {
      scope,
      namespace: { id: 'ns' },
      handle: {
        adapter: {
          unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => {
            events.push('unit');
            return fn(unit);
          },
        },
      },
    },
    registry: {
      entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
      effects: new Map([
        [
          'hooks.post',
          { ref: 'hooks.post', module: 'hooks', executor: 'hooks.post', input: { fields: {} } },
        ],
      ]),
      executors: new Map([
        [
          'hooks.post',
          {
            ref: 'hooks.post',
            module: 'hooks',
            effect: 'hooks.post',
            queue: 'effects',
            capability: [],
            inline: false,
          },
        ],
      ]),
    },
    clock: { now: () => now },
    directory: { backend: async () => ({ id: backendId, app: 'app', config: undefined }) },
    apps: new Map([['app', { source: { modules: [] } }]]),
  };
  return { input: input as never, enqueued, warned, conditions, events };
}

describe('the effects a restore left requested', () => {
  test('every requested effect with an executor gets its job again, keyed by its effect id', async () => {
    const { input, enqueued, conditions } = setup([
      row('e1', 'hooks.post'),
      row('e2', 'hooks.post'),
    ]);
    const handled = await reenqueueUnsettledEffects(input);
    expect(handled).toBe(2);
    expect(enqueued.map((job) => job.key)).toEqual([
      { value: 'e1', onConflict: 'keep' },
      { value: 'e2', onConflict: 'keep' },
    ]);
    expect(enqueued[0]).toMatchObject({
      kind: 'effect',
      queue: 'effects',
      run: { executor: 'hooks.post', effect: 'e1' },
      causation: { commandId: 'command-e1' },
      build: { id: 'build-1', revision: 1 },
    });
    expect(conditions[0]).toEqual({
      op: 'and',
      conditions: [{ op: 'eq', field: 'status', value: 'requested' }],
    });
  });

  test('the job acts as the service principal of the effect module', async () => {
    const { input, enqueued } = setup([row('e1', 'hooks.post')]);
    await reenqueueUnsettledEffects(input);
    expect(enqueued[0]?.principal).toMatchObject({
      resolver: 'core.module',
      principalId: 'hooks.system',
    });
  });

  test('a type the registry lacks is logged and skipped, and a failing enqueue fails the restore check', async () => {
    const lacking = setup([row('e1', 'gone.type'), row('e3', 'hooks.post')]);
    expect(await reenqueueUnsettledEffects(lacking.input)).toBe(1);
    expect(lacking.enqueued.map((job) => (job.run as { effect: string }).effect)).toEqual(['e3']);
    expect(lacking.warned.map((entry) => entry.fields?.effect)).toEqual(['e1']);
    expect(lacking.warned[0]?.fields).toMatchObject({ type: 'gone.type' });
    const failing = setup([row('e2', 'hooks.post'), row('e3', 'hooks.post')], 'e2');
    await expect(reenqueueUnsettledEffects(failing.input)).rejects.toThrow('the queue is down');
    expect(failing.enqueued).toEqual([]);
  });

  test('an effect whose job is alive in any state, running included, gets no second job', async () => {
    const deadline = Temporal.Instant.from('2026-11-20T08:00:00Z');
    const { input, enqueued } = setup(
      [
        row('e1', 'hooks.post'),
        row('e2', 'hooks.post'),
        row('e3', 'hooks.post', { performer: 'external', deadline }),
        row('e4', 'hooks.post', { performer: 'external', deadline }),
      ],
      undefined,
      {
        // e1 was taken when the backup was made (restored as running); e3's timer is waiting.
        alive: [
          ['effects', 'e1'],
          ['timers', 'core.deadline:e3'],
        ],
      },
    );
    expect(await reenqueueUnsettledEffects(input)).toBe(2);
    expect(enqueued.map((job) => job.key)).toEqual([
      { value: 'e2', onConflict: 'keep' },
      { value: 'core.deadline:e4', onConflict: 'keep' },
    ]);
  });

  test('the jobs carry the actor, the cause event and the reaction lineage of the requested event', async () => {
    const lineage = { depth: 3, origin: 'event-1' };
    const actor = { kind: 'user', id: 'ada', via: 'auth.session' };
    const deadline = Temporal.Instant.from('2026-11-20T08:00:00Z');
    const { input, enqueued } = setup(
      [
        row('e1', 'hooks.post'),
        row('e2', 'hooks.post', { performer: 'external', deadline }),
        row('e3', 'hooks.post'),
      ],
      undefined,
      {
        requested: {
          e1: { actor, causationId: 'event-9', lineage },
          e2: { actor, causationId: 'command-e2', lineage },
        },
      },
    );
    await reenqueueUnsettledEffects(input);
    expect(enqueued[0]?.causation).toEqual({
      commandId: 'command-e1',
      eventId: 'event-9',
      lineage,
      actor,
    });
    // A request caused by the command itself names no cause event.
    expect(enqueued[1]?.causation).toEqual({ commandId: 'command-e2', lineage, actor });
    // An effect with no readable record falls back to its command and the module's own actor.
    expect(enqueued[2]?.causation).toMatchObject({ commandId: 'command-e3' });
    expect(enqueued[2]?.causation).not.toHaveProperty('lineage');
    expect(enqueued[2]?.causation).not.toHaveProperty('eventId');
  });

  test('an executor effect requested for later keeps its runAt', async () => {
    const later = Temporal.Instant.from('2026-12-01T08:00:00Z');
    const { input, enqueued } = setup([
      row('e1', 'hooks.post', { runAt: later }),
      row('e2', 'hooks.post'),
    ]);
    await reenqueueUnsettledEffects(input);
    expect(enqueued[0]?.runAt).toEqual(later);
    expect(enqueued[1]).not.toHaveProperty('runAt');
  });

  test('an outside performer with a deadline gets its deadline timer again', async () => {
    const deadline = Temporal.Instant.from('2026-11-20T08:00:00Z');
    const { input, enqueued } = setup([
      row('e1', 'hooks.post', { performer: 'external', deadline }),
      row('e2', 'hooks.post', { performer: 'external' }),
      row('e3', 'hooks.post', { performer: 'external', deadline: null }),
    ]);
    expect(await reenqueueUnsettledEffects(input)).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: 'effect',
      queue: 'timers',
      run: { effectDeadline: 'e1' },
      runAt: deadline,
      key: { value: 'core.deadline:e1', onConflict: 'keep' },
      causation: { commandId: 'command-e1' },
    });
    expect(enqueued[0]?.principal).toMatchObject({ principalId: 'hooks.system' });
  });

  test('a page of rows at a time', async () => {
    const rows = Array.from({ length: 230 }, (_, n) =>
      row(`e${String(n).padStart(3, '0')}`, 'hooks.post'),
    );
    const { input, enqueued } = setup(rows);
    expect(await reenqueueUnsettledEffects(input)).toBe(230);
    expect(enqueued).toHaveLength(230);
  });

  describe('the lanes and the queued cap', () => {
    const roomy = { limitOf: () => ({ kind: 'count', value: 0 }) };
    /** A cache that answers the limits of each queue only after it was asked, and counts the asks. */
    const cacheOf = (events: string[]) => {
      const asked: string[] = [];
      const quotas = {
        fresh: async () => {
          asked.push('fresh');
          events.push('ask');
          return {
            ...roomy,
            queueOf: (_scope: unknown, queue: string) =>
              queue === 'timers'
                ? { running: 2, queued: 1, weight: 5 }
                : { running: 6, queued: 1, weight: 3 },
          };
        },
      };
      return { quotas, asked };
    };

    test('an effect job takes the lane its queue has for the tenant and carries no queued cap: it is counted and never refused', async () => {
      const { input, enqueued, events } = setup([row('e1', 'hooks.post'), row('e2', 'hooks.post')]);
      const { quotas, asked } = cacheOf(events);
      await reenqueueUnsettledEffects({ ...(input as object), quotas } as never);
      expect(enqueued).toHaveLength(2);
      for (const job of enqueued) {
        expect(job).toMatchObject({ queue: 'effects', laneCap: 6, laneWeight: 3 });
        expect(job).not.toHaveProperty('queuedCap');
      }
      // Asked for each job's unit, so a long restore never works on rows older than the cache allows.
      expect(asked).toEqual(['fresh', 'fresh']);
      // Each ask comes before the unit that enqueues: the read of the page, then ask and unit for each job.
      expect(events).toEqual(['unit', 'ask', 'unit', 'ask', 'unit']);
    });

    test('a deadline timer takes the lane of the timers queue and carries no queued cap', async () => {
      const deadline = Temporal.Instant.from('2026-11-20T08:00:00Z');
      const { input, enqueued, events } = setup([
        row('e1', 'hooks.post', { performer: 'external', deadline }),
      ]);
      const { quotas } = cacheOf(events);
      await reenqueueUnsettledEffects({ ...(input as object), quotas } as never);
      expect(enqueued[0]).toMatchObject({ queue: 'timers', laneCap: 2, laneWeight: 5 });
      expect(enqueued[0]).not.toHaveProperty('queuedCap');
    });
  });
});
