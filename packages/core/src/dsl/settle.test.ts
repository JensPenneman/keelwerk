import { describe, expect, test } from 'vitest';
import type { Id } from '../ids/id.ts';
import type { AnyEffectPart } from './define-effect.ts';
import { settle } from './settle.ts';

const id = 'eff_1' as Id<'core.effect'>;
const outcome = { ok: true, value: {} } as const;
const part = Object.assign(() => undefined, { ref: 'dispatch.ship' }) as unknown as AnyEffectPart;

describe('settle', () => {
  test('without options the draft is the released one', () => {
    const draft = settle(id, outcome);
    expect(Object.keys(draft)).toEqual(['kind', 'type', 'effect', 'outcome']);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  test('the options add the effect reference and the where', () => {
    expect(settle(id, outcome, { effect: part })).toEqual({
      kind: 'settle',
      type: 'settle',
      effect: 'eff_1',
      outcome,
      effectType: 'dispatch.ship',
    });
    expect(settle(id, outcome, { effect: part, where: { depot: 'north' } } as never)).toMatchObject(
      {
        effectType: 'dispatch.ship',
        where: { depot: 'north' },
      },
    );
  });

  test('an effect no module mounts is internal', () => {
    const unmounted = (() => undefined) as unknown as AnyEffectPart;
    expect(() => settle(id, outcome, { effect: unmounted })).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });
});
