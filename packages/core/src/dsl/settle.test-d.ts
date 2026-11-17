import { describe, expectTypeOf, test } from 'vitest';
import { hooksBase } from '../../test/fixtures/modules/hooks/src/base.ts';
import type { PlainEffectInputOf } from '../effects/plain-effect-input-of.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { Where } from '../model/where.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';
import { defineEffect } from './define-effect.ts';
import { settle } from './settle.ts';
import type { SettleOptions } from './settle-options.ts';

const ship = defineEffect(hooksBase, {
  input: shape({ depot: field.string(), recipient: field.string().personal() }),
  performer: 'external',
});
const id = 'x' as Id<'core.effect'>;
const outcome = { ok: true, value: {} } as const;

describe('settle options', () => {
  test('the third parameter takes the where of ctx.live.effects', () => {
    expectTypeOf<SettleOptions<typeof ship>['where']>().toEqualTypeOf<
      Where<PlainEffectInputOf<typeof ship>> | undefined
    >();
    expectTypeOf(
      settle(id, outcome, { effect: ship, where: { depot: 'north' } }),
    ).toEqualTypeOf<SettleEffect>();
  });

  test('a where over a personal or unknown member, or a where without its effect, does not compile', () => {
    // @ts-expect-error a personal member is not in the plain input
    settle(id, outcome, { effect: ship, where: { recipient: 'x' } });
    // @ts-expect-error an unknown member
    settle(id, outcome, { effect: ship, where: { nowhere: 'x' } });
    // @ts-expect-error a where needs the effect it filters
    settle(id, outcome, { where: { depot: 'north' } });
  });
});
