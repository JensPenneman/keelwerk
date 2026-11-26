import { describe, expect, test } from 'vitest';
import { answered, context } from '../../../test/authorization/fixtures.ts';
import { frozenPrincipal } from '../../principals/frozen-principal.ts';
import type { Membership } from '../../principals/membership.ts';
import type { Principal } from '../../principals/principal.ts';
import { keepOwnMemberships } from './keep-own-memberships.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalEnrichers } from './run-principal-enrichers.ts';

const user = answered(context('user', 'u1').principal);

/** A kit whose one enricher, filled by `module`, answers the given memberships and roles. */
function filling(
  module: string,
  memberships: readonly Membership[],
  roles: readonly string[] = [],
) {
  const kit: ResolverKit = {
    fills: () => [{ module, value: { enrich: () => ({ memberships, roles }) } }],
    drive: (generator) => Promise.resolve(generator as never),
  };
  return kit;
}

describe('runPrincipalEnrichers: whose membership kinds a fill may return', () => {
  test('a fill of members adds a membership of its own kind', async () => {
    const own = { kind: 'members.membership', id: 'm1', role: 'owner' };
    const enriched = await runPrincipalEnrichers(filling('members', [own]), user);
    expect(enriched.memberships).toContainEqual(own);
  });

  test('the enriched principal is a new one and is frozen', async () => {
    const own = { kind: 'members.membership', id: 'm1', role: 'owner' };
    const frozen = frozenPrincipal(user);
    const enriched = await runPrincipalEnrichers(filling('members', [own], ['admin']), frozen);
    expect(enriched).not.toBe(frozen);
    expect(Object.isFrozen(enriched) && Object.isFrozen(enriched.memberships)).toBe(true);
    expect(Object.isFrozen(enriched.roles)).toBe(true);
  });

  test('a fill of another module that returns the kind of members is internal and names no member value', async () => {
    const forged = { kind: 'members.membership', id: 'secret-id', role: 'secret-role' };
    const refused = runPrincipalEnrichers(filling('other', [forged]), user);
    await expect(refused).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: expect.stringContaining('"other"'),
    });
    await expect(refused).rejects.toMatchObject({
      message: expect.not.stringContaining('secret'),
    });
  });

  test('a kind that only starts like the module id is refused too', async () => {
    await expect(
      runPrincipalEnrichers(
        filling('members', [{ kind: 'membersX.membership', id: 'm1', role: 'owner' }]),
        user,
      ),
    ).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
  });

  test('a list that reads differently the second time lands no foreign kind', async () => {
    const reads = [[], [{ kind: 'members.membership', id: 'm1', role: 'admin' }]];
    const kit: ResolverKit = {
      fills: () => [
        {
          module: 'other',
          value: {
            enrich: () => ({
              get memberships() {
                return reads.shift() ?? [];
              },
            }),
          },
        },
      ],
      drive: (generator) => Promise.resolve(generator as never),
    };
    const enriched = await runPrincipalEnrichers(kit, user);
    expect(enriched.memberships.map((membership) => membership.kind)).not.toContain(
      'members.membership',
    );
  });

  test.each([
    [
      'change a kind',
      (handed: Principal) => {
        (handed.memberships[0] as { kind: string }).kind = 'other.membership';
      },
    ],
    [
      'add a membership',
      (handed: Principal) => {
        (handed.memberships as Membership[]).push({
          kind: 'other.membership',
          id: 'm2',
          role: 'x',
        });
      },
    ],
  ])('an enricher is handed frozen memberships: it cannot %s', async (_what, tamper) => {
    const kept = keepOwnMemberships('core.principalResolvers', 'members', [
      { kind: 'members.membership', id: 'm1', role: 'owner' },
    ]);
    const kit: ResolverKit = {
      fills: () => [
        {
          module: 'other',
          value: {
            enrich: (handed: Principal) => {
              tamper(handed);
              return {};
            },
          },
        },
      ],
      drive: (generator) => Promise.resolve(generator as never),
    };
    await expect(
      runPrincipalEnrichers(kit, frozenPrincipal({ ...user, memberships: kept })),
    ).rejects.toThrow(TypeError);
    expect(kept).toEqual([{ kind: 'members.membership', id: 'm1', role: 'owner' }]);
  });

  test('roles stay unchecked: any fill may add one', async () => {
    const enriched = await runPrincipalEnrichers(filling('other', [], ['auditor']), user);
    expect(enriched.roles).toContain('auditor');
  });
});
