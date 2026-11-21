import { describe, expect, test } from 'vitest';
import { effectEntity, receiptOf, stored } from './support/effects-kit.ts';
import { heldOverTheLimits } from './support/held-over-the-limits.ts';
import { boot } from './support/prepare-admission-world.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

// The commit tail of the unit of a command with `prepare` never refuses it by a storage limit: the
// limits are checked at its admission only. Each case but the last lets a command pass its
// admission, puts the tenant above both limits and shows that the decision is stored; the last is
// about the queued cap, which is no storage limit. What decides each case: the barrier or the cut
// that holds the first attempt, the awaited answers, the executor's count, the committed store and
// the counters; nothing runs in the background and no clock moves.

describe('the commit tail of a command with prepare', () => {
  test('a command with prepare whose tenant another unit put above the limits after its admission stores its decision', async () => {
    const { world, adapter, read, id, done, before } = await heldOverTheLimits('library.stock', {
      title: 'Stocked',
      isbn: 's-1',
    });
    expect(done.ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect((await stored(adapter)).books.map((book) => book.title).sort()).toEqual([
      'Grown',
      'Stocked',
    ]);
    const after = await read();
    expect(after[1]).toBe(before[1] + 1n);
    expect(after[0]).toBeGreaterThan(before[0]);
  });

  test('the inline reactions of a command with prepare are charged in its own unit and never refuse it', async () => {
    const { world, adapter, read, id, done, before } = await heldOverTheLimits(
      'library.stock',
      { title: 'Echoed', isbn: 's-1' },
      { echo: true },
    );
    expect(done.ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect((await stored(adapter)).books.map((book) => book.title).sort()).toEqual([
      'Echo',
      'Echoed',
      'Grown',
    ]);
    const after = await read();
    expect(after[1]).toBe(before[1] + 2n);
    expect(after[0]).toBeGreaterThan(before[0]);
  });

  // The cut stands for the invoker's deadline (invoker/stages/with-deadline.ts, reached through
  // execute.ts with `command: true`): at the action's `timeoutMs` it aborts the run's signal, which
  // takes the path of this abort (run-inline-executor.ts: acted, settle-inline-effect.ts: abandoned
  // with `core.effect_outcome_unknown`, no receipt). The guard job after a crash leaves a state that
  // differs in one field the resumed run reads: the `requestId` inside the stored error is a fresh
  // UUID there (run-effect-job.ts) and the run's own here. Admission reads neither, and the
  // resent id reads the error only as the answer value handed to `prepare`, which this case ignores.
  test('a resumed id of a cut first attempt stores its decision with the tenant above its limits', async () => {
    const { world, adapter, invoke, read } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000202';
    const input = { title: 'Stocked', isbn: 's-1' };
    const cut = new AbortController();
    world.onRun = () => cut.abort(new Error('the run was cut'));
    expect((await invoke('library.stock', input, { commandId: id, signal: cut.signal })).ok).toBe(
      false,
    );
    world.onRun = undefined;
    expect((await stored(adapter)).effects).toMatchObject([{ status: 'abandoned' }]);
    expect(await receiptOf(adapter, id)).toBeUndefined();
    world.bytes = 0;
    world.rows = 0;
    const before = await read();
    expect(before[0]).toBeGreaterThan(0n);
    expect(before[1]).toBeGreaterThan(0n);
    const resent = await invoke('library.stock', input, { commandId: id });
    expect(resent.ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect((await stored(adapter)).books.map((book) => book.title).sort()).toEqual([
      'Grown',
      'Stocked',
    ]);
    const after = await read();
    expect(after[1]).toBe(before[1] + 1n);
    expect(after[0]).toBeGreaterThan(before[0]);
  });

  // The queued cap is no storage limit and the admission does not look at it: the tail of a command
  // with `prepare` still refuses its unit with `core.queue_full` after its prepare step ran. The
  // refusal is retryable, so it is not pinned to the id (no receipt); the effect record of the
  // first attempt stays, so the id sent again with room starts no second effect and completes.
  test('a decision that enqueues a capped job is refused core.queue_full at the tail, and the id completes with room', async () => {
    const { world, adapter, invoke } = boot();
    const queued = () =>
      adapter.unit(namespace, tenant, (unit) => unit.jobs.queued('commands', 100));
    world.queued = 1;
    expect((await invoke('library.slow', {})).ok).toBe(true);
    expect(await queued()).toBe(1);
    const id = '00000000-0000-7000-8000-000000000203';
    expect(await invoke('library.queueing', {}, { commandId: id })).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.queue_full', retryAfter: 1 },
    });
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toBeUndefined();
    // `stored` takes the jobs it reads (a lease), so the effect rows are read on their own.
    expect(
      (await adapter.unit(namespace, tenant, (unit) => unit.rows.find(effectEntity, {}))).rows,
    ).toMatchObject([{ status: 'succeeded' }]);
    expect(await queued()).toBe(1);
    world.queued = 2;
    expect((await invoke('library.queueing', {}, { commandId: id })).ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect(await queued()).toBe(2);
  });
});
