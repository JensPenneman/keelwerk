import { describe, expect, test } from 'vitest';
import { answered, context } from '../../../test/authorization/fixtures.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalEnrichers } from './run-principal-enrichers.ts';
import { runPrincipalResolvers } from './run-principal-resolvers.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') };
const carrier = { transport: 'http' } as unknown as Carrier;
const user = answered(context('user', 'u1').principal);
const forged = { resolver: 'auth.session', principalId: 'u1' };

function kitOf(module: string, value: unknown, enrichers: unknown[] = []): ResolverKit {
  return {
    fills: (point) =>
      point === 'core.principalResolvers'
        ? [{ module, value }]
        : enrichers.map((enricher) => ({ module: 'other', value: enricher })),
    drive: (generator) => Promise.resolve(generator as never),
  };
}

describe('runPrincipalResolvers: the id of a resolver is read once', () => {
  test('an id that the resolver changes while it resolves does not land the id of another module', async () => {
    const resolver = {
      id: 'evil.keys',
      resolve() {
        resolver.id = 'auth.session';
        return { principal: { ...user, ref: forged } as Principal };
      },
    };
    await expect(
      runPrincipalResolvers(kitOf('evil', resolver), carrier, scope, clock),
    ).rejects.toMatchObject({
      kind: 'internal',
      message: expect.stringContaining(
        'names the resolver "auth.session", not its own "evil.keys"',
      ),
    });
  });

  test('an id getter that answers another module id after the first read lands the first', async () => {
    let reads = 0;
    const resolver = {
      get id() {
        reads += 1;
        return reads === 1 ? 'evil.keys' : 'auth.session';
      },
      resolve: () => ({ principal: user }),
    };
    const resolved = await runPrincipalResolvers(kitOf('evil', resolver), carrier, scope, clock);
    expect(resolved.principal.via).toBe('evil.keys');
  });
});

describe('runPrincipalResolvers: the inner copy of the reference', () => {
  test('a reference whose resolver reads differently the second time lands as it was checked', async () => {
    let reads = 0;
    const ref = {
      principalId: 'u1',
      get resolver() {
        reads += 1;
        return reads === 1 ? 'evil.keys' : 'auth.session';
      },
    };
    const resolver = { id: 'evil.keys', resolve: () => ({ principal: { ...user, ref } }) };
    const resolved = await runPrincipalResolvers(kitOf('evil', resolver), carrier, scope, clock);
    expect(resolved.principal.ref?.resolver).toBe('evil.keys');
    expect(resolved.principal.ref?.resolver).toBe('evil.keys');
  });
});

describe('runPrincipalEnrichers: what an enricher is handed', () => {
  test.each([
    ['via', 'api-keys.key'],
    ['ref', forged],
    ['kind', 'operator'],
  ])(
    'an enricher that tries to change %s leaves the principal as the kernel made it',
    async (field, value) => {
      const honest = { id: 'evil.keys', resolve: () => ({ principal: user }) };
      const enricher = {
        enrich(handed: Record<string, unknown>) {
          try {
            handed[field] = value;
          } catch {
            // a frozen principal refuses the write
          }
          return {};
        },
      };
      const kit = kitOf('evil', honest, [enricher]);
      const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
      const refBefore = resolved.principal.ref;
      const enriched = await runPrincipalEnrichers(kit, resolved.principal);
      expect(enriched).toMatchObject({ kind: 'user', via: 'evil.keys' });
      expect(enriched.ref).toEqual(refBefore);
    },
  );

  test('the reference an enricher is handed is frozen too', async () => {
    const withRef = { ...user, ref: { resolver: 'evil.keys', principalId: 'u1' } } as Principal;
    const honest = { id: 'evil.keys', resolve: () => ({ principal: withRef }) };
    const enricher = {
      enrich(handed: Principal) {
        (handed.ref as { resolver: string }).resolver = 'auth.session';
        return {};
      },
    };
    const kit = kitOf('evil', honest, [enricher]);
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    await expect(runPrincipalEnrichers(kit, resolved.principal)).rejects.toThrow(TypeError);
    expect(resolved.principal.ref?.resolver).toBe('evil.keys');
  });
});

/** As withResolverKit does: a bound enricher's factory is given the principal that `fills` is given. */
function factoryKit(answer: Principal, tamper: (handed: Principal, own: Principal) => void) {
  const kit: ResolverKit = {
    fills: (point, principal) =>
      point === 'core.principalResolvers'
        ? [{ module: 'evil', value: { id: 'evil.keys', resolve: () => ({ principal: answer }) } }]
        : [
            {
              module: 'other',
              value: {
                enrich(handed: Principal) {
                  tamper(handed, principal);
                  return {};
                },
              },
            },
          ],
    drive: (generator) => Promise.resolve(generator as never),
  };
  return kit;
}

async function enrichedWith(
  answer: Principal,
  tamper: (handed: Principal, own: Principal) => void,
): Promise<Principal> {
  const kit = factoryKit(answer, tamper);
  const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
  return runPrincipalEnrichers(kit, resolved.principal).catch(() => resolved.principal);
}

describe('runPrincipalEnrichers: nothing an enricher can see is the kernel principal', () => {
  test('what the factory of a bound enricher is given cannot change the kind or the resolver field', async () => {
    const enriched = await enrichedWith(user, (_handed, own) => {
      Object.assign(own, { kind: 'operator', via: 'api-keys.key' });
    });
    expect(enriched).toMatchObject({ kind: 'user', via: 'evil.keys' });
  });

  test('the scope it is handed cannot be set to null', async () => {
    const enriched = await enrichedWith(user, (handed) => {
      (handed.scope as { tenant: string | null }).tenant = null;
      (handed.scope as { backend: string | null }).backend = null;
    });
    expect(enriched.scope).toEqual(user.scope);
  });

  test('the claims it is handed cannot take a scope', async () => {
    const keyed = { ...user, claims: { scopes: ['read'] } } as Principal;
    const enriched = await enrichedWith(keyed, (handed) => {
      (handed.claims.scopes as string[]).push('write');
    });
    expect(enriched.claims.scopes).toEqual(['read']);
  });
});

describe('runPrincipalResolvers: the placeholder is frozen', () => {
  test('what the factory of a resolver is given cannot make the caller an operator when no resolver answers', async () => {
    const kit: ResolverKit = {
      fills: (_point, given) => {
        try {
          Object.assign(given, { kind: 'operator', id: 'root', via: 'evil.keys' });
        } catch {
          // a frozen principal refuses the write
        }
        return [{ module: 'evil', value: { id: 'evil.keys', resolve: () => null } }];
      },
      drive: (generator) => Promise.resolve(generator as never),
    };
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    expect(resolved.authenticated).toBe(false);
    expect(resolved.principal).toMatchObject({ kind: 'anonymous', via: 'core.invoker' });
  });
});
