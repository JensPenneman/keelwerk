import { describe, expect, test } from 'vitest';
import { answered, context, entityAction, rule } from '../../test/authorization/fixtures.ts';
import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { systemPrincipalOf } from '../effects/system-principal-of.ts';
import { operatorResolver } from '../invoker/edge/operator-resolver.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { principalOfActor } from '../replay/principal-of-actor.ts';
import type { Scope } from '../storage/scope.ts';
import { frozenPrincipal } from './frozen-principal.ts';
import { ownedPrincipal } from './owned-principal.ts';
import type { Principal } from './principal.ts';
import { runtimeOperator } from './runtime-operator.ts';

const scope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const placeholder = placeholderPrincipal(scope);

/** Whether a principal and every plain object or array in it is frozen. */
function frozenAllTheWay(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(frozenAllTheWay);
}

describe('every principal the kernel makes is frozen all the way down', () => {
  test.each<[string, () => Principal]>([
    ['the placeholder', () => placeholder],
    ['the service principal of a module', () => moduleServicePrincipal('loans', placeholder)],
    ['the system principal', () => systemPrincipalOf('reason', placeholder)],
    [
      'the operator of a local carrier',
      () => operatorResolver({ local: {} } as never) as Principal,
    ],
    ['the runtime operator', () => runtimeOperator],
    ...(['user', 'service', 'operator', 'system', 'anonymous'] as const).map(
      (kind): [string, () => Principal] => [
        `the principal of a ${kind} actor`,
        () => principalOfActor({ kind, id: 'x', via: 'v' }, scope),
      ],
    ),
  ])('%s', (_name, make) => {
    expect(frozenAllTheWay(make())).toBe(true);
  });
});

describe('frozenPrincipal', () => {
  test('shares nothing with what it copies and is frozen through the reference, scope, claims and memberships', () => {
    const source = {
      ...placeholder,
      kind: 'user',
      subject: 'u1',
      subjectRef: null,
      claims: { scopes: ['read'] },
      memberships: [{ kind: 'm.x', id: '1', role: 'r' }],
      ref: { resolver: 'm.keys', principalId: 'p' },
    } as unknown as Principal;
    const copy = frozenPrincipal(source);
    expect(frozenAllTheWay(copy)).toBe(true);
    expect(copy.claims).not.toBe(source.claims);
    expect(Object.isFrozen(source.claims)).toBe(false);
  });
});

describe('ownedPrincipal', () => {
  test('keeps what the kernel made, and rebuilds a principal that only looks frozen', () => {
    const made = moduleServicePrincipal('loans', placeholder);
    expect(ownedPrincipal(made)).toBe(made);
    const lookalike = Object.freeze({
      ...placeholder,
      claims: { x: 1 },
    }) as Principal;
    const owned = ownedPrincipal(lookalike);
    expect(owned).not.toBe(lookalike);
    expect(Object.isFrozen(owned.claims)).toBe(true);
    expect(Object.isFrozen(lookalike.claims)).toBe(false);
  });
});

describe('a rule callback is handed the kernel principal frozen', () => {
  const read = entityAction('get', { generated: 'get' });

  test('a write into it throws, and the gate afterwards judges the principal as it was', () => {
    const seen: string[] = [];
    const tampering = rule({
      id: 'doc.tamper',
      effect: 'allow',
      actions: ['read'],
      principal: 'user',
      when: (ctx) => {
        try {
          (ctx.principal as { kind: string }).kind = 'operator';
        } catch (error) {
          seen.push(error instanceof TypeError ? 'refused' : 'other');
        }
        seen.push(ctx.principal.kind);
        return true;
      },
    });
    const user = context('user', 'u1');
    const frozen = { ...user, principal: frozenPrincipal(answered(user.principal)) };
    const result = evaluateGate({ rules: [tampering], action: read, context: frozen });
    expect(result.allowed).toBe(true);
    expect(seen).toEqual(['refused', 'user']);
    expect(frozen.principal.kind).toBe('user');
  });
});
