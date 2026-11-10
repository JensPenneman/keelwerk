import { expectTypeOf, test } from 'vitest';
import type { EventEnvelope } from '../events/event-envelope.ts';
import type { Unit } from '../storage/unit.ts';
import type { ConsumerSpec } from './consumer-spec.ts';

test('ConsumerSpec.consume receives envelopes and the unit', () => {
  expectTypeOf<Parameters<ConsumerSpec['consume']>>().toEqualTypeOf<
    [events: readonly EventEnvelope[], unit: Unit]
  >();
  expectTypeOf<ConsumerSpec['start']>().toEqualTypeOf<'beginning' | 'now'>();
  expectTypeOf<Pick<ConsumerSpec, 'maxAttempts'>>().toEqualTypeOf<{
    readonly maxAttempts?: number;
  }>();
});
