import type { StorageRow, SubjectId } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { probeInput } from './support/hooks-kit.ts';
import { attemptsOf, drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';
import { watchedHooks } from './support/watched-hooks.ts';

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const owner = crypto.randomUUID() as SubjectId;
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

type Booted = Awaited<ReturnType<typeof watchedHooks>>;

async function probe(booted: Booted, mode: string, note?: string): Promise<void> {
  await booted.client.invoke(
    'probes.run',
    probeInput(owner, mode, note === undefined ? {} : { note }),
  );
  await drainHooks(booted);
}

async function later(booted: Booted, seconds: number): Promise<void> {
  await booted.runtime.advanceTo(start.add({ seconds }));
  await drainHooks(booted);
}

/** Changes what the effect row holds, below the write path: as a deploy that removed or changed a command would leave it. */
async function change(booted: Booted, effect: StorageRow, values: Record<string, unknown>) {
  const descriptor = booted.runtime.app.registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw new Error('no core.effect');
  await booted.raw((unit) =>
    unit.rows.update(descriptor, [
      {
        id: String(effect.id),
        expectedVersion: Number(effect.version),
        values: { ...effect, ...values },
      },
    ]),
  );
}

/** Runs a `hang` probe until its deadline: `whileHanging` runs once the attempt has started, then the clock passes `expireInSeconds` (5). */
async function hangPastDeadline(
  booted: Booted,
  whileHanging?: (effect: StorageRow) => Promise<void>,
) {
  await booted.client.invoke('probes.run', probeInput(owner, 'hang', {}));
  const hanging = await effectOf(booted, 'probes.act');
  if (hanging === undefined) throw new Error('no effect was requested');
  const draining = booted.runtime.drainJobs();
  await vi.waitFor(async () => {
    expect(await attemptsOf(booted, String(hanging.id))).toHaveLength(1);
  });
  await whileHanging?.(hanging);
  await booted.runtime.advanceTo(start.add({ seconds: 6 }));
  await draining;
  return hanging;
}

const jobOutcomes = (booted: Booted) => booted.spy.completions.map((entry) => entry.outcome.kind);

/** What must hold after any end of an attempt: the effect is settled, so no taker has an open attempt to find. */
function expectSettled(effect: StorageRow | undefined) {
  expect(effect?.status).not.toBe('requested');
}

describe('an effect never stays requested with an open attempt when the end of the attempt fails (7.9.5, D1)', () => {
  test('the continuation command is gone after a deploy: the effect settles with the answer it got, without a continuation', async () => {
    const booted = await watchedHooks(start, cleanup);
    // Attempt 1 is told to wait; while the effect waits, the build loses its continuation command.
    await probe(booted, 'rate_limited');
    const waiting = await effectOf(booted, 'probes.act');
    expect(waiting?.status).toBe('requested');
    await change(booted, waiting as StorageRow, { continuation: 'probes.target.gone' });
    await later(booted, 200);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({ status: 'succeeded', attempts: 2, output: { status: 200 } });
    expectSettled(effect);
    // The attempt that ran is closed by an end record, written in the fresh unit.
    const records = await attemptsOf(booted, String(effect?.id));
    expect(
      records.filter((record) => record.attempt === 2 && record.endedAt !== undefined),
    ).toHaveLength(1);
    expect(jobOutcomes(booted).at(-1)).toBe('succeeded');
    // No continuation ran: the target never recorded the outcome.
    expect((await rowsOf(booted, 'probes.target'))[0]?.result).toBeUndefined();
  });

  test('a retryable failure whose end unit hits a store error is still retried, not settled failed', async () => {
    const booted = await watchedHooks(start, cleanup);
    // The completion of the end unit of attempt 1 fails once: the executor was told to wait.
    let fails = 1;
    booted.spy.complete = () => {
      if (fails-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await probe(booted, 'rate_limited');
    const waiting = await effectOf(booted, 'probes.act');
    expect(waiting?.status).toBe('requested');
    expect(jobOutcomes(booted)).toEqual(['retry']);
    // Attempt 1 is closed by an end record that carries the failure, and the job waits for the next try.
    const closed = (await attemptsOf(booted, String(waiting?.id))).filter(
      (record) => record.attempt === 1 && record.endedAt !== undefined,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ error: { code: 'core.rate_limited', retryable: true } });
    await later(booted, 200);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({ status: 'succeeded', attempts: 2, output: { status: 200 } });
  });

  test('a store error at the end of the attempt keeps the continuation: the output is settled and the delivery recorded', async () => {
    const booted = await watchedHooks(start, cleanup);
    // The store fails the completion of the end unit once: the executor has run, and the unit rolls back.
    let fails = 1;
    booted.spy.complete = () => {
      if (fails-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await booted.client.invoke('hooks.notify', { payload: 'store hiccup' });
    await drainHooks(booted);
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'succeeded', output: { status: 200 } });
    expect(booted.endpoint.requests).toHaveLength(1);
    // The post succeeded and its continuation ran once: the delivery is no longer pending.
    expect((await rowsOf(booted, 'hooks.delivery'))[0]).toMatchObject({
      status: 'delivered',
      responseStatus: 200,
    });
  });

  test('a second failure of the fresh unit retries the job, and its next taker settles from the open attempt', async () => {
    const second = await watchedHooks(start, cleanup);
    let both = 2;
    second.spy.complete = () => {
      if (both-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await second.client.invoke('hooks.notify', { payload: 'store down' });
    await drainHooks(second);
    expect((await effectOf(second, 'hooks.post'))?.status).toBe('requested');
    expect(jobOutcomes(second)).toEqual(['retry']);
    await later(second, 3600);
    const settled = await effectOf(second, 'hooks.post');
    expect(settled).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    expectSettled(settled);
    // The destination was asked once; the next taker never posts again.
    expect(second.endpoint.requests).toHaveLength(1);
  });

  test('a next taker that finds an open attempt keeps the continuation, and drops only one that is gone', async () => {
    const kept = await watchedHooks(start, cleanup);
    let both = 2;
    kept.spy.complete = () => {
      if (both-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await kept.client.invoke('hooks.notify', { payload: 'kept' });
    await drainHooks(kept);
    expect((await effectOf(kept, 'hooks.post'))?.status).toBe('requested');
    await later(kept, 3600);
    expect(await effectOf(kept, 'hooks.post')).toMatchObject({ status: 'abandoned' });
    // The unknown outcome reaches the continuation, which records it on the delivery.
    expect((await rowsOf(kept, 'hooks.delivery'))[0]).toMatchObject({ status: 'failed' });

    const gone = await watchedHooks(start, cleanup);
    let twice = 2;
    gone.spy.complete = () => {
      if (twice-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await probe(gone, 'attempt');
    const open = await effectOf(gone, 'probes.act');
    expect(open?.status).toBe('requested');
    expect(jobOutcomes(gone)).toEqual(['retry']);
    // A deploy removes the continuation before the next taker comes.
    await change(gone, open as StorageRow, { continuation: 'probes.target.gone' });
    await later(gone, 3600);
    const effect = await effectOf(gone, 'probes.act');
    expect(effect).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    expect(jobOutcomes(gone).at(-1)).toBe('failed');
    expect((await rowsOf(gone, 'probes.target'))[0]?.result).toBeUndefined();
  });

  test('a wait of NaN seconds is no wait: the attempt retries, and the stored error has no retryAfter', async () => {
    const booted = await watchedHooks(start, cleanup);
    await probe(booted, 'nan');
    const waiting = await effectOf(booted, 'probes.act');
    expect(waiting?.status).toBe('requested');
    const [first] = await attemptsOf(booted, String(waiting?.id));
    expect(first).not.toHaveProperty('error.retryAfter');
    await later(booted, 120);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({ status: 'succeeded', attempts: 2 });
    expectSettled(effect);
  });

  test('an answer that does not fit the output shape settles abandoned, never failed: the destination acted', async () => {
    const booted = await watchedHooks(start, cleanup);
    await probe(booted, 'badshape');
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    // The continuation reads the unknown outcome, so a domain retry is a decision, not an accident.
    expect(String((await rowsOf(booted, 'probes.target'))[0]?.result)).toMatch(
      /^failed core\.effect_outcome_unknown: /,
    );
    expectSettled(effect);
  });

  test('a job of an effect the registry no longer holds settles it failed from its row, without a continuation', async () => {
    const booted = await watchedHooks(start, cleanup);
    await probe(booted, 'rate_limited');
    const waiting = await effectOf(booted, 'probes.act');
    expect(waiting?.status).toBe('requested');
    await booted.raw((unit) =>
      unit.jobs.enqueue({
        kind: 'effect',
        queue: 'probes',
        run: { executor: 'ghost.act', effect: String(waiting?.id) },
        scope: booted.scope,
        principal: { resolver: 'core.module', principalId: 'probes.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: booted.runtime.clock.now(),
        capability: [],
        key: { value: 'ghost', onConflict: 'keep' },
      }),
    );
    await drainHooks(booted);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({ status: 'failed', error: { code: 'core.internal' } });
    expect((await rowsOf(booted, 'probes.target'))[0]?.result).toBeUndefined();
  });

  test('a timeout whose end unit hits a store error is retried like in the end unit, not settled abandoned', async () => {
    const booted = await watchedHooks(start, cleanup);
    let fails = 1;
    booted.spy.complete = () => {
      if (fails-- > 0) throw new Error('the store failed');
      return undefined;
    };
    const hanging = await hangPastDeadline(booted);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect?.status).toBe('requested');
    expect(jobOutcomes(booted)).toEqual(['retry']);
    const closed = (await attemptsOf(booted, String(hanging.id))).filter(
      (record) => record.attempt === 1 && record.endedAt !== undefined,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ error: { code: 'core.timeout', retryable: true } });
  });

  test('an output over 64 KiB whose end unit hits a store error still settles failed with core.effect_output_too_large', async () => {
    const booted = await watchedHooks(start, cleanup);
    let fails = 1;
    booted.spy.complete = () => {
      if (fails-- > 0) throw new Error('the store failed');
      return undefined;
    };
    await probe(booted, 'big');
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({
      status: 'failed',
      error: { kind: 'unsupported', code: 'core.effect_output_too_large' },
    });
    expect(jobOutcomes(booted)[0]).toBe('failed');
    // The end record says what the effect says: the attempt did not succeed.
    const closed = (await attemptsOf(booted, String(effect?.id))).filter(
      (record) => record.attempt === 1 && record.endedAt !== undefined,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ error: { code: 'core.effect_output_too_large' } });
  });

  test('an effect settled meanwhile still gets the end record of the attempt when the end unit hits a store error', async () => {
    const booted = await watchedHooks(start, cleanup);
    let fails = 1;
    booted.spy.complete = () => {
      if (fails-- > 0) throw new Error('the store failed');
      return undefined;
    };
    // Another path settles the effect while attempt 1 runs.
    const hanging = await hangPastDeadline(booted, (effect) =>
      change(booted, effect, { status: 'abandoned' }),
    );
    expect((await effectOf(booted, 'probes.act'))?.status).toBe('abandoned');
    const closed = (await attemptsOf(booted, String(hanging.id))).filter(
      (record) => record.attempt === 1 && record.endedAt !== undefined,
    );
    expect(closed).toHaveLength(1);
    expect(jobOutcomes(booted)).toEqual(['succeeded']);
  });
});
