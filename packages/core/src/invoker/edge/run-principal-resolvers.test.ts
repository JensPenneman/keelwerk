import { describe, expect, test } from 'vitest';
import { context } from '../../../test/authorization/fixtures.ts';
import type { Principal } from '../../principals/principal.ts';
import { moduleServicePrincipal } from '../../reactions/module-service-principal.ts';
import type { Carrier } from '../carrier.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalResolvers } from './run-principal-resolvers.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') };
const carrier = { transport: 'http' } as unknown as Carrier;

/** A kit whose one resolver answers the given principal. */
function answering(principal: Principal): ResolverKit {
  return {
    fills: () => [{ module: 'evil', value: { id: 'evil.keys', resolve: () => ({ principal }) } }],
    drive: (generator) => Promise.resolve(generator as never),
  };
}

const user = context('user', 'u1').principal;
const service = context('service', 'loans.system').principal;

describe('runPrincipalResolvers: what a resolver may not answer', () => {
  test('an honest answer is taken, in the scope of the request', async () => {
    const resolved = await runPrincipalResolvers(answering(user), carrier, scope, clock);
    expect(resolved).toMatchObject({ authenticated: true, module: 'evil' });
  });

  test.each([
    ['via core.module', { ...service, via: 'core.module' }],
    [
      'a reference of core.module',
      { ...service, ref: { resolver: 'core.module', principalId: 'loans.system' } },
    ],
    ['via core.system', { ...user, via: 'core.system' }],
    [
      'a reference of core.runtime',
      { ...user, ref: { resolver: 'core.runtime', principalId: 'x' } },
    ],
    [
      'a reference of core.operator',
      {
        ...user,
        via: 'evil.keys',
        ref: { resolver: 'core.operator', principalId: 'local.socket' },
      },
    ],
    [
      'a reference of core.operatorToken',
      { ...user, ref: { resolver: 'core.operatorToken', principalId: 'tok' } },
    ],
    ['a system principal', { ...context('system').principal, via: 'evil.keys' }],
  ])('an answer with %s is internal', async (_name, principal) => {
    await expect(
      runPrincipalResolvers(answering(principal as Principal), carrier, scope, clock),
    ).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
  });

  test("not even the object the kernel minted gets through a resolver's hands", async () => {
    const minted = moduleServicePrincipal('loans', { scope: { backend: 'b1', tenant: 't1' } });
    await expect(
      runPrincipalResolvers(answering(minted), carrier, scope, clock),
    ).rejects.toMatchObject({
      kind: 'internal',
      message: expect.stringContaining("kernel's module resolver"),
    });
  });
});
