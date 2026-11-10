import { describe, expectTypeOf, test } from 'vitest';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

describe('StartPhaseInput', () => {
  test('the start input carries what a runtime service context is built from', () => {
    expectTypeOf<StartPhaseInput['apps']>().toEqualTypeOf<RuntimeServiceContext['apps']>();
    expectTypeOf<StartPhaseInput['invoker']>().toEqualTypeOf<RuntimeServiceContext['invoker']>();
    expectTypeOf<StartPhaseInput['clock']>().toEqualTypeOf<RuntimeServiceContext['clock']>();
    expectTypeOf<StartPhaseInput['composed']['infrastructure']['ledgers']>().toEqualTypeOf<
      RuntimeServiceContext['ledgers']
    >();
  });
});
