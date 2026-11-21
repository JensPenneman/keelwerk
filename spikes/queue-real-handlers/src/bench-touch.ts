import { defineEffect, defineEffectExecutor, field, shape } from '@keelwerk/core';
import { benchBase } from './bench-base.ts';

/** The queue the executor's jobs run in: the effect job of the measurement. */
export const touchQueue = 'touches';

export const touch = defineEffect(benchBase, {
  input: shape({ itemId: field.ref.own('item') }),
  output: shape({}),
});

/** The trivial executor: it does no I/O, so the measurement is of the job and not of the effect. */
export const touchExecutor = defineEffectExecutor(benchBase, touch, {
  queue: touchQueue,
  run: async () => ({}),
});
