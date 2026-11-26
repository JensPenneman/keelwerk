import { describe, expect, test } from 'vitest';
import { answered, context } from '../../../test/authorization/fixtures.ts';
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

const user = answered(context('user', 'u1').principal);
const service = answered(context('service', 'loans.system').principal);

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
    ['a system principal', { ...answered(context('system').principal), via: 'evil.keys' }],
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
      message: expect.stringContaining('principal carries "idAs"'),
    });
  });

  test('a user whose subject id is in upper case is an internal error, a lower-case one is taken', async () => {
    const subject = '0f1f2f3f-4f5f-6f7f-8f9f-afbfcfdfefff';
    for (const text of [subject.toUpperCase(), subject.replaceAll('-', '').toUpperCase()]) {
      await expect(
        runPrincipalResolvers(
          answering({ ...user, subject: text } as Principal),
          carrier,
          scope,
          clock,
        ),
      ).rejects.toMatchObject({
        kind: 'internal',
        message: expect.stringContaining('not in lower case'),
      });
    }
    for (const text of [subject, subject.replaceAll('-', ''), 'ada']) {
      await expect(
        runPrincipalResolvers(
          answering({ ...user, subject: text } as Principal),
          carrier,
          scope,
          clock,
        ),
      ).resolves.toMatchObject({ authenticated: true });
    }
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

describe('runPrincipalResolvers: whose membership kinds a resolver may return', () => {
  test('a resolver of another module that answers the kind of members is internal and names no member value', async () => {
    const forged = {
      ...user,
      memberships: [
        { kind: 'evil.device', id: 'd1', role: 'read' },
        { kind: 'members.membership', id: 'secret-id', role: 'secret-role' },
      ],
    } as Principal;
    const refused = runPrincipalResolvers(answering(forged, 'evil'), carrier, scope, clock);
    await expect(refused).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message:
        'A fill of core.principalResolvers by "evil" returned a membership of kind "members.membership", which is not a kind of "evil".',
    });
    await expect(refused).rejects.toMatchObject({ message: expect.not.stringContaining('secret') });
  });

  test('a kind that only starts like the module id is refused too', async () => {
    const lookalike = {
      ...user,
      memberships: [{ kind: 'evilX.device', id: 'd1', role: 'read' }],
    } as Principal;
    await expect(
      runPrincipalResolvers(answering(lookalike, 'evil'), carrier, scope, clock),
    ).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
    });
  });

  test.each([
    [
      'a list that reads differently the second time',
      () => {
        const reads = [[], [{ kind: 'members.membership', id: 'm1', role: 'admin' }]];
        return Object.defineProperty({ ...user }, 'memberships', {
          get: () => reads.shift() ?? [],
          enumerable: true,
        }) as Principal;
      },
    ],
    [
      'a kind that reads differently the second time',
      () => {
        const kinds = ['evil.device', 'members.membership'];
        const flipping = {
          get kind() {
            return kinds.shift() ?? 'members.membership';
          },
          id: 'm1',
          role: 'admin',
        };
        return { ...user, memberships: [flipping] } as Principal;
      },
    ],
  ])('%s lands no foreign kind', async (_title, principalOf) => {
    const taken = await runPrincipalResolvers(
      answering(principalOf(), 'evil'),
      carrier,
      scope,
      clock,
    ).then(
      (resolved) => resolved.principal.memberships.map((membership) => membership.kind),
      () => [],
    );
    expect(taken).not.toContain('members.membership');
  });

  test("a resolver's own kind is taken", async () => {
    const own = {
      ...user,
      memberships: [{ kind: 'evil.device', id: 'd1', role: 'read' }],
    } as Principal;
    await expect(
      runPrincipalResolvers(answering(own, 'evil'), carrier, scope, clock),
    ).resolves.toMatchObject({ principal: { memberships: [{ kind: 'evil.device' }] } });
  });
});

describe('runPrincipalResolvers: the id of a resolver is its module', () => {
  test("a fill answering under an id that is not its module's is internal, whoever's id it copies", async () => {
    for (const id of ['auth.session', 'evilX.keys', 'keys', 'evil']) {
      await expect(
        runPrincipalResolvers(answering(user, 'evil', id), carrier, scope, clock),
      ).rejects.toMatchObject({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of core.principalResolvers by "evil" has a resolver whose id "${id}" is not an id of "evil".`,
      });
    }
  });

  test('the principal says through the resolver that answered, whatever the answer says', async () => {
    const claiming = { ...user, via: 'api-keys.key' } as Principal;
    const resolved = await runPrincipalResolvers(answering(claiming), carrier, scope, clock);
    expect(resolved.principal.via).toBe('evil.keys');
  });
});

describe('runPrincipalResolvers: an answer is read once', () => {
  const flip = (field: string, first: unknown, then: unknown) => {
    const reads = [first];
    return Object.defineProperty({ ...user }, field, {
      get: () => reads.shift() ?? then,
      enumerable: true,
    }) as Principal;
  };

  test.each([
    [
      'ref',
      { resolver: 'evil.keys', principalId: 'k1' },
      { resolver: 'auth.session', principalId: 'k1' },
    ],
    ['kind', 'user', 'operator'],
    ['subject', 'ada', 'ADA'],
  ])(
    'a %s that reads differently the second time lands as it was checked',
    async (field, first, then) => {
      const resolved = await runPrincipalResolvers(
        answering(flip(field, first, then)),
        carrier,
        scope,
        clock,
      );
      expect(resolved.principal).toMatchObject({ [field]: first });
    },
  );
});
