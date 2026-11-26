import { describe, expect, test } from 'vitest';
import { answered, context } from '../../../test/authorization/fixtures.ts';
import type { Carrier } from '../carrier.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalEnrichers } from './run-principal-enrichers.ts';
import { runPrincipalResolvers } from './run-principal-resolvers.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') };
const carrier = { transport: 'http' } as unknown as Carrier;
const user = answered(context('user', 'u1').principal) as unknown as Record<string, unknown>;

function kitOf(principal: unknown, enricher?: unknown): ResolverKit {
  return {
    fills: (point) =>
      point === 'core.principalResolvers'
        ? [{ module: 'evil', value: { id: 'evil.keys', resolve: () => ({ principal }) } }]
        : enricher === undefined
          ? []
          : [{ module: 'other', value: enricher }],
    drive: (generator) => Promise.resolve(generator as never),
  };
}

/**
 * An array of a class of its own whose `map` and `filter` build their result through
 * Symbol.species: a copy that calls them gets whatever the constructor returns, here a proxy whose
 * reads stay live.
 */
function liveArray(
  read: (key: string) => unknown,
  length: number,
  items: readonly unknown[] = [],
): unknown[] {
  class Live extends Array<unknown> {
    static override get [Symbol.species](): ArrayConstructor {
      return function Made(_size: number) {
        return new Proxy([] as unknown[], {
          defineProperty: () => true,
          get: (target, key, receiver) =>
            typeof key === 'string' && (/^\d+$/.test(key) || key === 'resolver')
              ? read(key)
              : Reflect.get(target, key, receiver),
        });
      } as unknown as ArrayConstructor;
    }
  }
  const made = new Live();
  for (let index = 0; index < length; index += 1) made.push(items[index] ?? 'x');
  return made;
}

describe('an answered array of a class of its own chooses nothing the kernel keeps', () => {
  test('a reference answered as such an array is refused, not kept live', async () => {
    const ref = liveArray((key) => (key === 'resolver' ? 'evil.keys' : undefined), 0);
    await expect(
      runPrincipalResolvers(kitOf({ ...user, ref }), carrier, scope, clock),
    ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('"ref"') });
  });

  test('a list inside the claims takes no scope after the checks', async () => {
    const scopes = ['read'];
    const claims = { scopes: liveArray((key) => scopes[Number(key)], 1, ['read']) };
    const resolved = await runPrincipalResolvers(kitOf({ ...user, claims }), carrier, scope, clock);
    scopes[0] = 'write';
    expect(resolved.principal.claims.scopes).toEqual(['read']);
    expect(Object.isFrozen(resolved.principal.claims.scopes)).toBe(true);
  });

  test('the memberships an enricher returns are checked as they are kept', async () => {
    let reads = 0;
    const own = { kind: 'other.device', id: 'm1', role: 'x' };
    const forged = { kind: 'members.membership', id: 'm1', role: 'owner' };
    const memberships = liveArray(
      (key) => {
        if (key !== '0') return undefined;
        reads += 1;
        return reads === 1 ? own : forged;
      },
      1,
      [own],
    );
    const kit = kitOf(user, { enrich: () => ({ memberships }) });
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    const enriched = await runPrincipalEnrichers(kit, resolved.principal);
    expect(enriched.memberships.map((membership) => membership.kind)).toEqual(['other.device']);
  });
});

describe('the roles an enricher returns', () => {
  test('are read by length and index, not through an iterator of their own', async () => {
    class Sly extends Array<unknown> {
      override *[Symbol.iterator](): ArrayIterator<unknown> {
        yield 'forged';
      }
    }
    const roles = new Sly();
    roles.push('reader');
    const kit = kitOf(user, { enrich: () => ({ roles }) });
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    const enriched = await runPrincipalEnrichers(kit, resolved.principal);
    expect(enriched.roles).toContain('reader');
    expect(enriched.roles).not.toContain('forged');
  });
});

/** A container that answers its first read of each member truly and every read after that hostilely. */
function onceProxy<T extends object>(target: T, hostile: unknown): T {
  const reads = new Map<string | symbol, number>();
  return new Proxy(target, {
    get(real, key, receiver) {
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      return count === 1 ? Reflect.get(real, key, receiver) : hostile;
    },
  });
}

describe('every container of an answer is read once', () => {
  test('a principal whose every container is a proxy comes out with the first answers only, and stays so', async () => {
    const hostile = 'evil';
    const wrap = <T extends object>(value: T): T => onceProxy(value, hostile);
    const membership = wrap({ kind: 'evil.device', id: 'm1', role: 'r' });
    const principal = wrap({
      ...user,
      ref: wrap({ resolver: 'evil.keys', principalId: 'u1' }),
      scope: wrap({ backend: 'b1', tenant: 't1' }),
      claims: wrap({ list: wrap(['read']), label: 'x' }),
      memberships: wrap([membership]),
    });
    const resolved = await runPrincipalResolvers(kitOf(principal), carrier, scope, clock);
    const made = resolved.principal;
    const snapshot = JSON.stringify(made);
    expect(made).toMatchObject({
      ref: { resolver: 'evil.keys', principalId: 'u1' },
      scope: { backend: 'b1', tenant: 't1' },
      claims: { list: ['read'], label: 'x' },
      memberships: [{ kind: 'evil.device', id: 'm1', role: 'r' }],
    });
    // Read and write every proxy afterwards: nothing in the principal moves.
    for (const container of [
      principal,
      principal.ref,
      principal.scope,
      principal.claims,
      membership,
    ]) {
      for (const key of Object.keys(container)) {
        void (container as Record<string, unknown>)[key];
        try {
          (container as Record<string, unknown>)[key] = hostile;
        } catch {
          // a proxy over a frozen target refuses
        }
      }
    }
    expect(JSON.stringify(made)).toBe(snapshot);
  });
});
