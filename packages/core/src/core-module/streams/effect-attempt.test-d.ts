import { describe, expectTypeOf, test } from 'vitest';
import type { EffectAttemptRecord } from '../../effects/effect-attempt-record.ts';
import type { ShapeValue } from '../../fields/shape-value.ts';
import type { CoreBase } from '../core-base-type.ts';

type Fields = CoreBase['streams']['effectAttempt']['record'] extends { readonly fields: infer F }
  ? F
  : never;
type Value = ShapeValue<Fields, 'core', 'draft'>;

describe('the core.effectAttempt record', () => {
  test('EffectAttemptRecord is what the record shape takes', () => {
    expectTypeOf<EffectAttemptRecord>().toExtend<Value>();
    expectTypeOf<keyof EffectAttemptRecord>().toEqualTypeOf<keyof Value>();
  });
});
