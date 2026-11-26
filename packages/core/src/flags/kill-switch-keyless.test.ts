import { describe, expect, test } from 'vitest';
import { storedFlagRow, targetingRig } from '../../test/targeting-cache-kit.ts';
import type { FlagLevel } from '../dsl/define-flag.ts';
import type { Principal } from '../principals/principal.ts';
import type { Scope } from '../storage/scope.ts';
import { flagContextOf } from './flag-context-of.ts';
import type { FlagSpec } from './flag-spec.ts';
import type { FlagTargeting } from './flag-targeting.ts';
import { resolveFlag } from './resolve-flag.ts';

const anonymous: Principal = { kind: 'anonymous', roles: [], ref: null } as never;
const scopes: Record<'deployment' | 'backend' | 'tenant', Scope> = {
  deployment: { level: 'deployment' },
  backend: { level: 'backend', backendId: 'b1' },
  tenant: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
};
const levels = ['deployment', 'backend', 'tenant'] as const;

const killSwitch = (level: FlagLevel): FlagSpec<boolean> => ({
  key: 'shop.checkout',
  kind: 'boolean',
  level,
  default: true,
  purpose: 'kill-switch',
});

/** What an anonymous caller without a client id reads from the one stored row of `shop.checkout`. */
async function readAnonymous(
  level: (typeof levels)[number],
  targeting: unknown,
  scope: keyof typeof scopes = level,
) {
  const r = targetingRig([storedFlagRow(targeting)]);
  await r.cache.fresh();
  const context = flagContextOf(level, {
    scope: scopes[scope],
    principal: anonymous,
    clientId: null,
  });
  const read = resolveFlag([r.cache.provider], killSwitch(level), context);
  r.stop();
  return { read, context, errors: r.errors, fields: r.fields };
}

const closed: FlagTargeting = { enabled: true, rules: [], fallthrough: { value: false } };

describe('a kill switch that its row closes', () => {
  // Under a deployment session no level has a targeting key at all.
  test.each(levels)(
    'a kill switch closed by its row reads closed for an anonymous caller without a client id (level %s)',
    async (level) => {
      for (const scope of [level, 'deployment'] as const) {
        const { read, context } = await readAnonymous(level, closed, scope);
        expect(context.targetingKey === null).toBe(scope === 'deployment');
        expect(read).toMatchObject({ value: false, reason: 'STATIC' });
      }
    },
  );

  test('a rule aimed at anonymous callers closes it for them, with no key', async () => {
    const { read, context } = await readAnonymous('deployment', {
      enabled: true,
      rules: [
        { id: 'anon', when: { principalKind: { eq: 'anonymous' } }, serve: { value: false } },
      ],
      fallthrough: { value: true },
    });
    expect(context.targetingKey).toBeNull();
    expect(read).toMatchObject({ value: false, reason: 'TARGETING_MATCH' });
  });

  test('a stored split on a kill switch reads closed, whoever the caller is', async () => {
    const split = {
      enabled: true,
      rules: [],
      fallthrough: {
        split: [
          { value: true, weight: 5000 },
          { value: false, weight: 5000 },
        ],
      },
    };
    for (const level of levels) {
      const { read, errors, fields } = await readAnonymous(level, split);
      expect(read).toMatchObject({ value: false, reason: 'ERROR', errorCode: 'PARSE_ERROR' });
      // The operator finds why the action is suspended in the log.
      expect(errors).toEqual([
        'a stored flag targeting does not fit the flag declaration; the kill switch reads closed',
      ]);
      expect(fields).toEqual([
        expect.objectContaining({ reason: expect.stringContaining('serves no split') }),
      ]);
    }
  });
});
