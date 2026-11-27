import { describe, expect, test } from 'vitest';
import { compileFlagRow } from '../flags/compile-flag-row.ts';
import { evaluateTargeting } from '../flags/evaluate-targeting.ts';
import type { FlagContext } from '../flags/flag-context.ts';
import type { FlagSpec } from '../flags/flag-spec.ts';
import type { FlagTargeting } from '../flags/flag-targeting.ts';
import { scrubFlagTargeting } from './scrub-flag-targeting.ts';

const tenant = '11111111-1111-4111-8111-111111111111';
const erased = '0192f3a0-0000-7000-8000-0000000000a1';
const other = '0192f3a0-0000-7000-8000-0000000000b2';
const killSwitch: FlagSpec<boolean> = {
  key: 'shop.checkout',
  kind: 'boolean',
  level: 'principal',
  default: true,
  purpose: 'kill-switch',
};
const ordinary: FlagSpec<boolean> = { ...killSwitch, purpose: 'release', default: false };
const open = { value: true };
const closed = { value: false };

function readAs(spec: FlagSpec<boolean>, targeting: unknown, id: string): boolean {
  const row = compileFlagRow({
    id: 'flg-1',
    key: spec.key,
    backendId: 'b1',
    version: 1,
    targeting: targeting as FlagTargeting,
  });
  const context: FlagContext = {
    scope: { level: 'tenant', backendId: 'b1', tenantId: tenant },
    principal: { kind: 'user', id, roles: [] },
    attributes: {},
    targetingKey: tenant,
  };
  return evaluateTargeting(spec, row, context).value;
}

const named = (serve: { value: boolean }, fallthrough: { value: boolean }): FlagTargeting => ({
  enabled: true,
  rules: [{ id: 'one', tenants: [tenant], principals: [erased], serve }],
  fallthrough,
});

describe('the erasure of a subject and the principals of a flag rule', () => {
  test('a kill switch closed for everyone but the erased subject reads closed for another user of the tenant', () => {
    const targeting = named(open, closed);
    expect(readAs(killSwitch, targeting, erased)).toBe(true);
    const scrubbed = scrubFlagTargeting(targeting, erased);
    expect(readAs(killSwitch, scrubbed, other)).toBe(false);
  });

  test('an ordinary flag rule that named only the erased subject is dropped and another user gets the fallthrough', () => {
    const scrubbed = scrubFlagTargeting(named(open, closed), erased) as FlagTargeting;
    expect(scrubbed.rules).toEqual([]);
    expect(readAs(ordinary, scrubbed, other)).toBe(false);
  });

  test('a rule naming the erased subject and another keeps the other', () => {
    const targeting: FlagTargeting = {
      enabled: true,
      rules: [{ id: 'one', tenants: [tenant], principals: [erased, other], serve: open }],
      fallthrough: closed,
    };
    const scrubbed = scrubFlagTargeting(targeting, erased) as FlagTargeting;
    expect(scrubbed.rules).toEqual([
      { id: 'one', tenants: [tenant], principals: [other], serve: open },
    ]);
    expect(readAs(ordinary, scrubbed, other)).toBe(true);
    expect(readAs(ordinary, scrubbed, erased)).toBe(false);
  });

  test('a rule that names no principal is kept as it is, and the object answers by identity when the subject is nowhere', () => {
    const targeting: FlagTargeting = {
      enabled: true,
      rules: [{ id: 'all', tenants: [tenant], serve: open }],
      fallthrough: closed,
    };
    expect(scrubFlagTargeting(targeting, erased)).toBe(targeting);
  });
});
