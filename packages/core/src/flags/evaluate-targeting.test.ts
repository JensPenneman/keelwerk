import { describe, expect, test } from 'vitest';
import { compileFlagRow } from './compile-flag-row.ts';
import { evaluateTargeting } from './evaluate-targeting.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagSpec } from './flag-spec.ts';
import type { FlagTargeting } from './flag-targeting.ts';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const flag: FlagSpec<boolean> = {
  key: 'shop.checkout',
  kind: 'boolean',
  level: 'tenant',
  default: false,
  purpose: 'release',
};
const principalFlag: FlagSpec<boolean> = { ...flag, key: 'shop.beta', level: 'principal' };

function context(
  overrides: { tenantId?: string; id?: string | null; roles?: string[]; key?: string | null } = {},
): FlagContext {
  const tenantId = overrides.tenantId ?? tenantA;
  return {
    scope: { level: 'tenant', backendId: 'b1', tenantId },
    principal: {
      kind: 'user',
      id: overrides.id === undefined ? 'u1' : overrides.id,
      roles: overrides.roles ?? [],
    },
    attributes: {},
    targetingKey: overrides.key === undefined ? tenantId : overrides.key,
  };
}

function rowOf(targeting: FlagTargeting, version = 3, backendId: string | null = null) {
  return compileFlagRow({ id: 'flg-1', key: 'shop.checkout', backendId, version, targeting });
}

const on = { value: true };
const off = { value: false };

describe('evaluateTargeting', () => {
  test('disabled serves the declared default with DISABLED and the row version', () => {
    const row = rowOf({ enabled: false, rules: [], fallthrough: on });
    expect(evaluateTargeting(flag, row, context())).toMatchObject({
      value: false,
      reason: 'DISABLED',
      provider: 'core.targeting',
      ruleVersion: 3,
    });
  });

  test('the first matching rule wins and reports its id', () => {
    const row = rowOf({
      enabled: true,
      rules: [
        { id: 'first', tenants: [tenantA], serve: on },
        { id: 'second', tenants: [tenantA], serve: off },
      ],
      fallthrough: off,
    });
    expect(evaluateTargeting(flag, row, context())).toMatchObject({
      value: true,
      reason: 'TARGETING_MATCH',
      ruleId: 'first',
      ruleVersion: 3,
    });
  });

  test('a tenant list matches in that tenant only, never in backend scope', () => {
    const row = rowOf({
      enabled: true,
      rules: [{ id: 'a', tenants: [tenantA], serve: on }],
      fallthrough: off,
    });
    expect(evaluateTargeting(flag, row, context({ tenantId: tenantB })).value).toBe(false);
    const backendScope: FlagContext = {
      ...context(),
      scope: { level: 'backend', backendId: 'b1' },
    };
    expect(evaluateTargeting(flag, row, backendScope)).toMatchObject({
      value: false,
      reason: 'STATIC',
    });
  });

  test('a principal list matches the principal id', () => {
    const row = rowOf(
      {
        enabled: true,
        rules: [{ id: 'p', principals: ['u1'], serve: on }],
        fallthrough: off,
      },
      3,
      'b1',
    );
    expect(evaluateTargeting(flag, row, context({ id: 'u1' })).value).toBe(true);
    expect(evaluateTargeting(flag, row, context({ id: 'u2' })).value).toBe(false);
    expect(evaluateTargeting(flag, row, context({ id: null })).value).toBe(false);
  });

  test("a rule over an attribute condition matches principalRoles contains 'beta'", () => {
    const row = rowOf({
      enabled: true,
      rules: [{ id: 'roles', when: { principalRoles: { contains: 'beta' } }, serve: on }],
      fallthrough: off,
    });
    expect(evaluateTargeting(flag, row, context({ roles: ['beta', 'x'] })).value).toBe(true);
    expect(evaluateTargeting(flag, row, context({ roles: ['x'] })).value).toBe(false);
  });

  test('a 30 % split keeps every key that was in when raised to 50 %', () => {
    const splitOf = (inShare: number) =>
      rowOf({
        enabled: true,
        rules: [],
        fallthrough: {
          split: [
            { value: true, weight: inShare },
            { value: false, weight: 10_000 - inShare },
          ],
        },
      });
    const thirty = splitOf(3000);
    const fifty = splitOf(5000);
    let inThirty = 0;
    let inFifty = 0;
    for (let n = 0; n < 1000; n++) {
      const ctx = context({ key: `user-${n}` });
      const small = evaluateTargeting(principalFlag, thirty, ctx);
      const large = evaluateTargeting(principalFlag, fifty, ctx);
      expect(small.reason).toBe('SPLIT');
      if (small.value) {
        inThirty++;
        expect(large.value).toBe(true);
      }
      if (large.value) inFifty++;
    }
    expect(inThirty).toBeGreaterThanOrEqual(250);
    expect(inThirty).toBeLessThanOrEqual(350);
    expect(inFifty).toBeGreaterThanOrEqual(450);
    expect(inFifty).toBeLessThanOrEqual(550);
  });

  test('a split without a targeting key answers ERROR TARGETING_KEY_MISSING from core.targeting', () => {
    const row = rowOf({
      enabled: true,
      rules: [],
      fallthrough: {
        split: [
          { value: true, weight: 5000 },
          { value: false, weight: 5000 },
        ],
      },
    });
    expect(evaluateTargeting(flag, row, context({ key: null }))).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
      provider: 'core.targeting',
    });
  });

  test('the fallthrough serves STATIC, or SPLIT without a rule id', () => {
    expect(
      evaluateTargeting(flag, rowOf({ enabled: true, rules: [], fallthrough: on }), context()),
    ).toMatchObject({
      value: true,
      reason: 'STATIC',
    });
    const split = rowOf({
      enabled: true,
      rules: [],
      fallthrough: { split: [{ value: true, weight: 10_000 }] },
    });
    const answer = evaluateTargeting(flag, split, context());
    expect(answer).toMatchObject({ value: true, reason: 'SPLIT' });
    expect(answer.ruleId).toBeUndefined();
  });
});
