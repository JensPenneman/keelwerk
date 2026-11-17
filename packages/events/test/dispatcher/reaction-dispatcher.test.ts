import type { ConsumerSpec } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { startTestRuntime } from '@keelwerk/testing';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { describe, expect, test } from 'vitest';
import { consumers } from '../../src/consumers/consumers.ts';
import { reactionDispatcher } from '../../src/dispatcher/reaction-dispatcher.ts';

function refusal(work: () => unknown): { kind: string; code: string } | undefined {
  try {
    work();
  } catch (error) {
    if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
    throw error;
  }
  return undefined;
}

describe('the reaction dispatcher', () => {
  test('an option that is no whole number of at least 1 is a validation error', () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(refusal(() => reactionDispatcher({ queued: 0 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ queued: 1.5 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ holdMs: 0 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ queued: 1, holdMs: 1 }))).toBeUndefined();
    expect(refusal(() => reactionDispatcher())).toBeUndefined();
  });

  test('maxDepth that is not a whole number of at least 1 is validation', () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(refusal(() => reactionDispatcher({ maxDepth: 0 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: -3 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: 2.5 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: Number.NaN }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: 1 }))).toBeUndefined();
    expect(refusal(() => reactionDispatcher({ maxDepth: 64 }))).toBeUndefined();
  });

  test('a maxDepth above 2,147,483,646 is validation: a job of depth 2^31 would read back as malformed and the chain would start again', () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(refusal(() => reactionDispatcher({ maxDepth: 2_147_483_647 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: 2 ** 40 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ maxDepth: Number.POSITIVE_INFINITY }))).toEqual(
      invalid,
    );
    expect(refusal(() => reactionDispatcher({ maxDepth: 2_147_483_646 }))).toBeUndefined();
  });

  test('a queued above 2,386,092,940 is validation: the pause asks the job store for 90 percent of it, which refuses a limit above 2,147,483,646', () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(refusal(() => reactionDispatcher({ queued: 3_000_000_000 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ queued: 2_386_092_941 }))).toEqual(invalid);
    expect(refusal(() => reactionDispatcher({ queued: 2_386_092_940 }))).toBeUndefined();
    // The line of the largest accepted cap is a limit the store takes.
    expect(Math.floor((9 * 2_386_092_940) / 10)).toBeLessThanOrEqual(2_147_483_646);
  });

  test("a worker that runs 'asyncReactions' without the dispatcher is refused when it is built", () => {
    expect(refusal(() => consumers({ consumers: [], runs: ['asyncReactions'] }))).toEqual({
      kind: 'validation',
      code: 'core.validation',
    });
    expect(
      refusal(() => consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] })),
    ).toBeUndefined();
  });

  test('only the dispatcher is recognised, by its mark: a consumer named like it, or any other core. id, is refused', () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    const lookalike = {
      id: 'core.reactions',
      selector: {},
      start: 'now' as const,
      consume: () => Promise.resolve(),
    };
    expect(refusal(() => consumers({ consumers: [lookalike] }))).toEqual(invalid);
    expect(refusal(() => consumers({ consumers: [lookalike], runs: ['asyncReactions'] }))).toEqual(
      invalid,
    );
    expect(refusal(() => consumers({ consumers: [{ ...lookalike, id: 'core.audit' }] }))).toEqual(
      invalid,
    );
    // A builder that names a kernel id is refused too, and so is a copy of the real builder's id.
    const builder = Object.assign(() => lookalike, { id: 'core.reactions' as const });
    expect(refusal(() => consumers({ consumers: [builder], runs: ['asyncReactions'] }))).toEqual(
      invalid,
    );
    expect(
      refusal(() => consumers({ consumers: [{ ...lookalike, id: 'reports.core.x' }] })),
    ).toBeUndefined();
  });

  test('a builder that returns a spec named core. without the mark is refused at start', async () => {
    const builder = (): ConsumerSpec => ({
      id: 'core.audit',
      selector: {},
      start: 'now',
      consume: () => Promise.resolve(),
    });
    const worker = consumers({ consumers: [builder] });
    const runtime = await startTestRuntime(libraryApp, { eventWorkers: [worker] });
    try {
      await expect(worker.settled()).rejects.toMatchObject({ kind: 'validation' });
    } finally {
      await runtime.stop();
    }
  });

  test('with the dispatcher the same worker starts, and its consumer is core.reactions', async () => {
    const worker = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
    const runtime = await startTestRuntime(libraryApp, { eventWorkers: [worker] });
    try {
      await expect(worker.settled()).resolves.toBe(0);
    } finally {
      await runtime.stop();
    }
  });
});
