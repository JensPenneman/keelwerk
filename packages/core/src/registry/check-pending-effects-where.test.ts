import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from './action-entry.ts';
import { checkPendingEffectsWhere } from './check-pending-effects-where.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { Registry } from './registry.ts';

const ship: EffectEntry = {
  ref: 'dispatch.ship',
  module: 'dispatch',
  name: 'ship',
  performer: 'external',
  executor: null,
  input: shape({
    parcel: field.string(),
    depot: field.string(),
    recipient: field.string().personal({ subject: 'parcel' }),
    token: field.secret(),
  }),
  output: shape({}),
  dataSubject: 'parcel',
};

function registryOf(
  handler: (input: { readonly [key: string]: unknown }, ctx: Context) => unknown,
): Registry {
  const action = {
    ref: 'dispatch.pending',
    module: 'dispatch',
    kind: 'subscription',
    handler,
  } as unknown as ActionEntry;
  return {
    actions: new Map([['dispatch.pending', action]]),
    effects: new Map([['dispatch.ship', ship]]),
  } as unknown as Registry;
}

interface Context {
  readonly live: { effects(effect: object, options?: object): unknown };
}

const app = {} as ComposableApp;
const part = { ref: 'dispatch.ship' };

describe('checkPendingEffectsWhere', () => {
  test('a where over a personal member is refused at compose', () => {
    const problems = checkPendingEffectsWhere(
      app,
      registryOf((input, ctx) => ctx.live.effects(part, { where: { recipient: input.who } })),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'pendingEffectsSealedFilter',
        severity: 'error',
        module: 'dispatch',
        ref: 'dispatch.pending',
        message:
          '"dispatch.pending" filters the pending effects of "dispatch.ship" by "recipient", which is no plaintext member of its input.',
      }),
    ]);
  });

  test('a where over a secret member is refused at compose', () => {
    const problems = checkPendingEffectsWhere(
      app,
      registryOf((_input, ctx) =>
        ctx.live.effects(part, { where: { and: [{ depot: 'north' }, { token: 'x' }] } }),
      ),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('"token"');
  });

  test('a where over a plain member passes', () => {
    const problems = checkPendingEffectsWhere(
      app,
      registryOf((input, ctx) => ctx.live.effects(part, { where: { depot: input.depot } })),
    );
    expect(problems).toEqual([]);
  });

  test('a source that throws before ctx.live.effects is no problem', () => {
    const problems = checkPendingEffectsWhere(
      app,
      registryOf(() => {
        throw new Error('not on a probe');
      }),
    );
    expect(problems).toEqual([]);
  });
});
