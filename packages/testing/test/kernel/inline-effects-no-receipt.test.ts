import { KeelwerkError, kernelCommandId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  bootPair,
  cutAfterPing,
  draftOf,
  namedPrincipal,
  type PairContext,
} from './support/inline-pair-kit.ts';
import { anonymous, stamp } from './support/run-read-kit.ts';

const inProgress = { code: 'core.command_in_progress' };
const mismatch = { code: 'core.idempotency_mismatch' };

/** Ping with a fixed input, then pong with the member `dest` of the command input. */
function* pingThenPong(input: Readonly<Record<string, unknown>>, ctx: PairContext) {
  yield* ctx.perform(draftOf('ping', { to: 'fixed' }));
  return yield* ctx.perform(draftOf('pong', { to: String(input.dest) }));
}

describe('an inline row whose command id has no receipt', () => {
  test('an anonymous caller is never answered from it: refused, and the later effect never runs', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({ prepare: pingThenPong, onPing: cut.onPing });
    await expect(
      pair.run('c-cut-1', { dest: 'x' }, { principal: anonymous, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const error = await pair
      .run('c-cut-1', { dest: 'y' }, { principal: anonymous })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(inProgress);
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(0);
  });

  test('the same input after the cut is refused too, so the answer never depends on the input', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({ prepare: pingThenPong, onPing: cut.onPing });
    await expect(
      pair.run('c-cut-2', { dest: 'x' }, { principal: anonymous, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const error = await pair
      .run('c-cut-2', { dest: 'x' }, { principal: anonymous })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(inProgress);
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(0);
  });

  test('the same named caller with the same input after the cut is answered and goes on', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({ prepare: pingThenPong, onPing: cut.onPing });
    const ada = namedPrincipal('ada');
    await expect(
      pair.run('c-cut-3', { dest: 'x' }, { principal: ada, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    await pair.run('c-cut-3', { dest: 'x' }, { principal: ada });
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(1);
  });

  test('a kernel command id is never refused for want of a receipt: the job that was cut goes on', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({ prepare: pingThenPong, onPing: cut.onPing });
    const commandId = kernelCommandId('effect', 'e-1');
    await expect(
      pair.run(commandId, { dest: 'x' }, { principal: anonymous, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    await pair.run(commandId, { dest: 'x' }, { principal: anonymous });
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(1);
  });

  test('a decide rejection leaves a row whose anonymous retry is refused, and the executor ran once', async () => {
    const pair = bootPair({
      prepare: pingThenPong,
      decide: (() => {
        throw new KeelwerkError({ kind: 'validation', code: 'core.validation', message: 'no' });
      }) as never,
    });
    await expect(
      pair.run('c-reject-1', { dest: 'x' }, { principal: anonymous }),
    ).rejects.toMatchObject({ code: 'core.validation' });
    const error = await pair
      .run('c-reject-1', { dest: 'x' }, { principal: anonymous })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(inProgress);
    expect(pair.pings).toHaveLength(1);
  });

  test('the refusal turns into a mismatch once the run that made the row cannot be alive, and not before', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({
      prepare: pingThenPong,
      onPing: cut.onPing,
      action: { timeoutMs: 5000 },
    });
    await expect(
      pair.run('c-bound-1', { dest: 'x' }, { principal: anonymous, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const at = (milliseconds: number) => ({ now: () => stamp.add({ milliseconds }) });
    const ask = (milliseconds: number) =>
      pair
        .run('c-bound-1', { dest: 'x' }, { principal: anonymous, clock: at(milliseconds) })
        .catch((caught: unknown) => caught);
    expect(await ask(64_999)).toMatchObject(inProgress);
    expect(await ask(65_000)).toMatchObject(mismatch);
    expect(pair.pongs).toHaveLength(0);
  });

  test('an action with no timeoutMs has no bound: still in progress an hour later', async () => {
    const cut = cutAfterPing();
    const pair = bootPair({ prepare: pingThenPong, onPing: cut.onPing });
    await expect(
      pair.run('c-bound-2', { dest: 'x' }, { principal: anonymous, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const error = await pair
      .run(
        'c-bound-2',
        { dest: 'x' },
        { principal: anonymous, clock: { now: () => stamp.add({ hours: 1 }) } },
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(inProgress);
  });

  test('an expired receipt of action A does not let action B, with a longer window, answer the row', async () => {
    const pair = bootPair({
      prepare: pingThenPong,
      action: { idempotencyWindowMs: 1000 },
      second: {},
    });
    await pair.run('c-expired-1', { dest: 'x' }, { principal: anonymous });
    const error = await pair
      .run(
        'c-expired-1',
        { dest: 'x' },
        {
          principal: anonymous,
          action: 'library.probeB',
          clock: { now: () => stamp.add({ minutes: 10 }) },
        },
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(inProgress);
    expect(pair.pings).toHaveLength(1);
  });
});
