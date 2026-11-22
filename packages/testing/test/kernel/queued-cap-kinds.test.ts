import type { QuotaLimit, Registry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  command,
  effectsKit,
  externalEffect,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import type { InlinePrepareContext } from './support/inline-kit.ts';
import { quotasOf, withRequestRates } from './support/rate-quota-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

// What a request, a decision or a job asks for anew meets the queued cap of its queue in its scope
// (9.5.5): a timer a decision sets, an effect job a decision requests, an inline effect's job and an
// external effect's deadline timer, besides the command jobs WP-172 pinned. What decides each case:
// the answer of the second call (`core.queue_full`), and the number of jobs waiting in the queue
// afterwards (the store's own count): exactly the cap, so the refused call left nothing. The
// limits are a double that answers one cap for every queue named and a roomy one for the others.

const roomy = 1_000_000;
const capped = (queued: Readonly<Record<string, number>>) =>
  quotasOf({
    limitOf: withRequestRates((_registry, _scope, ref): QuotaLimit => {
      return ref === 'core.rows'
        ? { kind: 'count', value: roomy }
        : { kind: 'bytes', value: roomy };
    }),
    queueOf: (_scope, queue) => ({ running: 4, queued: queued[queue] ?? roomy, weight: 1 }),
  });

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

const notify = externalEffect('notify', async () => ({ ok: true }));
const lookup = externalEffect('lookup', async () => ({ ok: true }), { inline: true });
const shipped = externalEffect(
  'ship',
  async () => ({ ok: true }),
  {},
  { performer: 'external', executor: null },
);
const input = { to: 'ada@example.org' };

const registry: Registry = registryWith({
  effects: [notify.effect, lookup.effect, shipped.effect],
  executors: [notify.executor, lookup.executor],
  actions: [
    // A timer under a new key on every call, due in an hour.
    command('timer', (i: { n?: number }) => ({
      effects: [
        {
          kind: 'setTimer',
          type: 'setTimer',
          key: `k-${i.n ?? 0}`,
          after: '1h',
          action: 'library.later',
          input: {},
        },
      ],
    })),
    // A timer under one key: it replaces itself and stays one job.
    command('retimer', () => ({
      effects: [
        {
          kind: 'setTimer',
          type: 'setTimer',
          key: 'same',
          after: '1h',
          action: 'library.later',
          input: {},
        },
      ],
    })),
    command('effect', (i: { n?: number }, ctx: Writes) => ({
      events: [ctx.write.library.book.create({ title: 'T', isbn: `x-${i.n}`, addedBy: 'ada' })],
      effects: [{ kind: 'external', type: 'library.notify', input }],
    })),
    // The effect runs inline, before the decision, in units of its own: its guard job is the one that is queued.
    command('inline', () => [], {
      prepare: function* (_i: unknown, ctx: InlinePrepareContext) {
        yield* ctx.perform({ kind: 'external', type: 'library.lookup', input });
      },
    } as never),
    command('deadline', () => ({
      effects: [
        {
          kind: 'external',
          type: 'library.ship',
          input,
          deadline: Temporal.Instant.from('2030-01-01T00:00:00Z'),
        },
      ],
    })),
    command('later', () => []),
  ],
});

/** Calls `action` `times` times with a command id of its own and answers each outcome. */
async function callTimes(
  invoke: ReturnType<typeof effectsKit>['invoke'],
  action: string,
  times: number,
) {
  const outcomes = [];
  for (let n = 1; n <= times; n += 1) {
    outcomes.push(
      await invoke(
        action,
        { n },
        { commandId: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` },
      ),
    );
  }
  return outcomes;
}

const waiting = (
  adapter: ReturnType<typeof effectsKit>['adapter'],
  queue: string,
): Promise<number> => adapter.unit(namespace, tenant, (unit) => unit.jobs.queued(queue, 100));

describe('what a decision asks for anew meets the cap of its queue', () => {
  // The job of an inline effect ends with the effect, so it is never waiting when the next call
  // comes: its cap is 0, which refuses the first call and leaves no job.
  test.each([
    ['a timer a decision sets under a new key', 'library.timer', 'timers', 1],
    ['the job of an effect a decision requests', 'library.effect', 'effects', 1],
    ['the deadline timer of an external effect', 'library.deadline', 'timers', 1],
    ['the guard job of an inline effect', 'library.inline', 'effects', 0],
  ])('%s ends in core.queue_full at the true count', async (_name, action, queue, cap) => {
    const { adapter, invoke } = effectsKit(registry, { quotas: capped({ [queue]: cap }) });
    const outcomes = await callTimes(invoke, action, cap + 1);
    expect(outcomes.slice(0, cap).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[cap]).toMatchObject({ ok: false, error: { code: 'core.queue_full' } });
    expect(await waiting(adapter, queue)).toBe(cap);
  });

  // The deadline timer is asked for anew in the unit of the decision that requests the effect, so
  // the two are admitted or refused together: a refusal leaves no effect that was accepted.
  test('an external effect whose deadline timer is refused is refused with it: no effect record is left', async () => {
    const { adapter, invoke } = effectsKit(registry, { quotas: capped({ timers: 1 }) });
    const [first] = await callTimes(invoke, 'library.deadline', 1);
    expect(first).toMatchObject({ ok: true });
    expect((await stored(adapter)).effects).toHaveLength(1);
    const refused = await invoke(
      'library.deadline',
      { n: 2 },
      { commandId: '00000000-0000-7000-8000-000000000002' },
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.queue_full' } });
    expect((await stored(adapter)).effects).toHaveLength(1);
    expect(await waiting(adapter, 'timers')).toBe(1);
  });

  test('a timer under one key replaces itself: it stays one job and meets no cap', async () => {
    const { adapter, invoke } = effectsKit(registry, { quotas: capped({ timers: 1 }) });
    const outcomes = await callTimes(invoke, 'library.retimer', 3);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(await waiting(adapter, 'timers')).toBe(1);
  });

  test('a queue with a roomy cap meets nothing though another queue of the tenant is at its cap', async () => {
    const { adapter, invoke } = effectsKit(registry, { quotas: capped({ effects: 1 }) });
    const outcomes = await callTimes(invoke, 'library.timer', 3);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(await waiting(adapter, 'timers')).toBe(3);
  });
});
