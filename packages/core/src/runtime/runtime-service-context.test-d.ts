import { describe, expectTypeOf, test } from 'vitest';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { ErasureStep } from '../subjects/erasure-step.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';

describe('what the step reach of the erasure adds', () => {
  test('a runtime service context has the compute pool as a required member', () => {
    expectTypeOf<RuntimeServiceContext['compute']>().toEqualTypeOf<ComputePool>();
    expectTypeOf<undefined>().not.toExtend<RuntimeServiceContext['compute']>();
  });

  test('the step names have the step reach', () => {
    expectTypeOf<'reach'>().toExtend<ErasureStep>();
  });
});
