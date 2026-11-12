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
function answering(principal: Principal, module = 'evil', id = `${module}.keys`): ResolverKit {
  return {
    fills: () => [{ module, value: { id, resolve: () => ({ principal }) } }],
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

const operator = {
  kind: 'operator',
  id: 'olive',
  scope: { backend: 'b1', tenant: 't1' },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test.principal',
  ref: { resolver: 'test.principal', principalId: 'olive' },
} as Principal;

describe('runPrincipalResolvers: the reference names the answering resolver', () => {
  test('a principal whose reference names another resolver is internal', async () => {
    const forged = { ...user, ref: { resolver: 'auth.session', principalId: 'ada' } } as Principal;
    await expect(
      runPrincipalResolvers(answering(forged, 'evil', 'evil.keys'), carrier, scope, clock),
    ).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: expect.stringContaining(
        'names the resolver "auth.session", not its own "evil.keys"',
      ),
    });
  });

  test("a reference that names the resolver's own id, or none, is taken", async () => {
    const own = { ...user, ref: { resolver: 'evil.keys', principalId: 'k1' } } as Principal;
    await expect(
      runPrincipalResolvers(answering(own), carrier, scope, clock),
    ).resolves.toMatchObject({ authenticated: true });
    await expect(
      runPrincipalResolvers(answering(user), carrier, scope, clock),
    ).resolves.toMatchObject({ authenticated: true });
  });
});

describe('runPrincipalResolvers: operators', () => {
  test("an operator answered by a module's resolver is internal", async () => {
    await expect(
      runPrincipalResolvers(answering(operator), carrier, scope, clock),
    ).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: 'A fill of core.principalResolvers by "evil" answered an operator.',
    });
  });

  test("the core's own fill may answer an operator", async () => {
    const resolved = await runPrincipalResolvers(
      answering(operator, 'core', 'test.principal'),
      carrier,
      scope,
      clock,
    );
    expect(resolved).toMatchObject({ authenticated: true, module: 'core' });
    expect(resolved.principal.kind).toBe('operator');
  });
});

describe('runPrincipalResolvers: the retired-pin check', () => {
  /** A kit whose resolver records the context it was given. */
  function recording(seen: unknown[]): ResolverKit {
    return {
      fills: () => [
        {
          module: 'keys',
          value: {
            id: 'keys.key',
            resolve: (_carrier: unknown, ctx: unknown) => {
              seen.push(ctx);
              return { principal: user };
            },
          },
        },
      ],
      drive: (generator) => Promise.resolve(generator as never),
    };
  }

  test('the resolver receives the retired-pin check', async () => {
    const seen: { retiredPinTarget?: (pin: string) => string | undefined }[] = [];
    await runPrincipalResolvers(recording(seen), carrier, scope, clock, (pin) =>
      pin === '2026-01-01' ? '2026-06-01' : undefined,
    );
    expect(seen[0]?.retiredPinTarget?.('2026-01-01')).toBe('2026-06-01');
    expect(seen[0]?.retiredPinTarget?.('2026-06-01')).toBeUndefined();
  });

  test('without a check the context names none', async () => {
    const seen: object[] = [];
    await runPrincipalResolvers(recording(seen), carrier, scope, clock);
    expect(seen[0]).toBeDefined();
    expect('retiredPinTarget' in (seen[0] ?? {})).toBe(false);
  });
});
