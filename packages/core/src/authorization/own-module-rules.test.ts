import { describe, expect, test } from 'vitest';
import { context, entityAction, moduleAction, rule } from '../../test/authorization/fixtures.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { Principal } from '../principals/principal.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import { effectiveRules } from './effective-rules.ts';
import { evaluateGate } from './evaluate-gate.ts';
import { ownModuleRules } from './own-module-rules.ts';

const registry = {
  modules: [{ id: 'loans' }, { id: 'library' }],
  entities: new Map([
    ['loans.loan', { ref: 'loans.loan', module: 'loans', name: 'loan' }],
    ['library.book', { ref: 'library.book', module: 'library', name: 'book' }],
  ]),
  rules: new Map(),
} as unknown as Pick<Registry, 'modules' | 'entities' | 'rules'>;

const rules = ownModuleRules(registry as Registry);
const moduleLevel = moduleAction('loans', 'sweep');
const entityCommand = entityAction('create', { entity: 'loans.loan', generated: 'create' });

function as(principal: Principal): PrincipalContext {
  return { ...context(), principal } as PrincipalContext;
}

const caused = { scope: { backend: 'b1', tenant: 't1' } };
const minted = moduleServicePrincipal('loans', caused);

describe('the own-module default rule', () => {
  test('a minted principal passes a module-level action and an entity command, named by core.ownModule', () => {
    for (const action of [moduleLevel, entityCommand]) {
      const result = evaluateGate({ rules, action, context: as(minted) });
      expect(result.allowed).toBe(true);
      expect(result.rules).toEqual([{ id: 'core.ownModule.loans', effect: 'allow' }]);
      expect(evaluateGate({ rules: [], action, context: as(minted) }).allowed).toBe(false);
    }
  });

  test('what only looks like the module principal is refused: a user, a literal, a copy', () => {
    const literal = {
      ...context('service', 'loans.system').principal,
      via: 'core.module',
      ref: { resolver: 'core.module', principalId: 'loans.system' },
    } as Principal;
    const copy = { ...minted } as Principal;
    const user = context('user', 'loans.system').principal;
    for (const principal of [user, literal, copy]) {
      for (const action of [moduleLevel, entityCommand]) {
        expect(evaluateGate({ rules, action, context: as(principal) }).allowed).toBe(false);
      }
    }
  });

  test("another module's principal is refused on this module's action", () => {
    const other = moduleServicePrincipal('library', caused);
    for (const action of [moduleLevel, entityCommand]) {
      expect(evaluateGate({ rules, action, context: as(other) }).allowed).toBe(false);
    }
    expect(
      evaluateGate({
        rules,
        action: entityAction('create', { entity: 'library.book', generated: 'create' }),
        context: as(other),
      }).allowed,
    ).toBe(true);
  });

  test('a deny rule of the module that covers service principals still refuses', () => {
    const deny = rule({
      id: 'loans.freeze',
      effect: 'deny',
      entity: 'loans',
      actions: ['sweep'],
      principal: 'service',
      reason: 'Loans are frozen.',
    });
    const result = evaluateGate({
      rules: [deny, ...rules],
      action: moduleLevel,
      context: as(minted),
    });
    expect(result).toMatchObject({ allowed: false, reason: 'Loans are frozen.' });
  });

  test('a refusal does not name the default rule among the allow rules that would have had to hold', () => {
    const other = moduleServicePrincipal('library', caused);
    expect(evaluateGate({ rules, action: moduleLevel, context: as(other) })).toEqual({
      allowed: false,
      rules: [],
      reason: undefined,
    });
  });

  test('effectiveRules appends the default rules and refuses a registry rule that uses their id', () => {
    expect(effectiveRules(registry).map((r) => r.id)).toEqual([
      'core.ownModule.loans',
      'core.ownModule.loans',
      'core.ownModule.library',
      'core.ownModule.library',
    ]);
    const colliding = {
      ...registry,
      rules: new Map([
        [
          'core.ownModule.loans',
          {
            id: 'core.ownModule.loans',
            module: 'x',
            effect: 'allow',
            subject: { module: 'x' },
            actions: ['*'],
            disabled: false,
          },
        ],
      ]),
    } as unknown as Pick<Registry, 'modules' | 'entities' | 'rules'>;
    expect(() => effectiveRules(colliding)).toThrowError(
      expect.objectContaining({ kind: 'internal' }),
    );
  });
});
