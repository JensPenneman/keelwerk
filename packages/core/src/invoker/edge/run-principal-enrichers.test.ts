import { describe, expect, test } from 'vitest';
import { context } from '../../../test/authorization/fixtures.ts';
import type { Membership } from '../../principals/membership.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalEnrichers } from './run-principal-enrichers.ts';

const user = context('user', 'u1').principal;

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

  test('roles stay unchecked: any fill may add one', async () => {
    const enriched = await runPrincipalEnrichers(filling('other', [], ['auditor']), user);
    expect(enriched.roles).toContain('auditor');
  });
});
