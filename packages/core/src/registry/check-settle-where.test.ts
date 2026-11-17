import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from './action-entry.ts';
import { checkSettleWhere } from './check-settle-where.ts';
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

function registryOf(handler: () => unknown, kind: ActionEntry['kind'] = 'command'): Registry {
  const action = {
    ref: 'dispatch.report',
    module: 'dispatch',
    kind,
    handler,
  } as unknown as ActionEntry;
  return {
    actions: new Map([['dispatch.report', action]]),
    effects: new Map([['dispatch.ship', ship]]),
  } as unknown as Registry;
}

const app = {} as ComposableApp;
const settleOf = (where?: unknown) => ({
  kind: 'settle',
  type: 'settle',
  effect: 'x',
  outcome: { ok: true, value: {} },
  effectType: 'dispatch.ship',
  ...(where === undefined ? {} : { where }),
});

describe('checkSettleWhere', () => {
  test('a settle whose where names a personal or secret member is refused at compose', () => {
    const personal = checkSettleWhere(
      app,
      registryOf(() => ({ effects: [settleOf({ recipient: 'x' })] })),
    );
    expect(personal).toEqual([
      expect.objectContaining({
        code: 'settleSealedFilter',
        severity: 'error',
        module: 'dispatch',
        ref: 'dispatch.report',
        message:
          '"dispatch.report" settles "dispatch.ship" filtered by "recipient", which is no plaintext member of its input.',
      }),
    ]);
    const secret = checkSettleWhere(
      app,
      registryOf(() => ({ effects: [settleOf({ and: [{ depot: 'north' }, { token: 'x' }] })] })),
    );
    expect(secret).toHaveLength(1);
    expect(secret[0]?.message).toContain('"token"');
  });

  test('a where over plain members, a settle without a where and a decide that throws are no problem', () => {
    expect(
      checkSettleWhere(
        app,
        registryOf(() => ({ effects: [settleOf({ depot: 'north' })] })),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => ({ effects: [settleOf()] })),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => {
          throw new Error('not on a probe');
        }),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => ({
          effects: [{ ...settleOf({ recipient: 'x' }), effectType: 'none.x' }],
        })),
      ),
    ).toEqual([]);
  });

  test('a decide that is a generator or answers no effects is skipped', () => {
    function* generator() {
      yield { kind: 'load' };
      return { effects: [settleOf({ recipient: 'x' })] };
    }
    expect(checkSettleWhere(app, registryOf(generator))).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => undefined),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => [1, 2]),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => ({ events: [] })),
      ),
    ).toEqual([]);
    expect(
      checkSettleWhere(
        app,
        registryOf(() => ({ effects: [settleOf({ recipient: 'x' })] }), 'query'),
      ),
    ).toEqual([]);
  });
});
