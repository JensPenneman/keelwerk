import { describe, expect, test } from 'vitest';
import { context, entityAction, moduleAction, rule } from '../../test/authorization/fixtures.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import { evaluateGate } from './evaluate-gate.ts';

const read = entityAction('get', { generated: 'get' });

describe('evaluateGate', () => {
  test('default deny names the allow rules that would have had to hold', () => {
    const rules = [
      rule({ id: 'doc.post.users', effect: 'allow', actions: ['read'], principal: 'user' }),
    ];
    const result = evaluateGate({ rules, action: read, context: context('anonymous') });
    expect(result).toEqual({
      allowed: false,
      rules: [{ id: 'doc.post.users', effect: 'allow' }],
      reason: undefined,
    });
    expect(evaluateGate({ rules, action: read, context: context() }).allowed).toBe(true);
  });

  test('no rules at all is a denial with no ids', () => {
    expect(evaluateGate({ rules: [], action: read, context: context() })).toEqual({
      allowed: false,
      rules: [],
      reason: undefined,
    });
  });

  test('a deny that covers every row ends the gate with its reason; a conditional one does not', () => {
    const allow = rule({ id: 'a', effect: 'allow', actions: ['read'] });
    const frozen = rule({
      id: 'freeze',
      effect: 'deny',
      actions: ['read'],
      reason: 'Tenant frozen.',
    });
    const some = rule({
      id: 'some',
      effect: 'deny',
      actions: ['read'],
      where: () => ({ status: 'trashed' }),
      reason: 'x',
    });
    const denied = evaluateGate({ rules: [allow, frozen], action: read, context: context() });
    expect(denied).toEqual({
      allowed: false,
      rules: [{ id: 'freeze', effect: 'deny' }],
      reason: 'Tenant frozen.',
    });
    expect(evaluateGate({ rules: [allow, some], action: read, context: context() }).allowed).toBe(
      true,
    );
  });

  test('an allow that can never hold does not open the gate', () => {
    const never = rule({ id: 'n', effect: 'allow', actions: ['read'], where: () => false });
    expect(evaluateGate({ rules: [never], action: read, context: context() }).allowed).toBe(false);
  });

  test('module-level actions need an allow whose when holds and no deny whose when holds', () => {
    const action = moduleAction('auth', 'login');
    const allow = rule({
      id: 'auth.open',
      effect: 'allow',
      entity: 'auth',
      actions: ['login'],
      when: (_ctx, input) => (input as { ok?: boolean }).ok === true,
    });
    const deny = rule({
      id: 'auth.blocked',
      effect: 'deny',
      entity: 'auth',
      actions: ['login'],
      when: (_ctx, input) => (input as { blocked?: boolean }).blocked === true,
      reason: 'Blocked.',
    });
    const rules = [allow, deny];
    expect(evaluateGate({ rules, action, context: context(), input: { ok: true } }).allowed).toBe(
      true,
    );
    expect(evaluateGate({ rules, action, context: context(), input: {} }).allowed).toBe(false);
    const blocked = evaluateGate({
      rules,
      action,
      context: context(),
      input: { ok: true, blocked: true },
    });
    expect(blocked).toEqual({
      allowed: false,
      rules: [{ id: 'auth.blocked', effect: 'deny' }],
      reason: 'Blocked.',
    });
  });

  test('an absent when holds', () => {
    const rules = [rule({ id: 'auth.open', effect: 'allow', entity: 'auth', actions: ['login'] })];
    expect(
      evaluateGate({ rules, action: moduleAction('auth', 'login'), context: context('anonymous') })
        .allowed,
    ).toBe(true);
    expect(
      evaluateGate({ rules, action: moduleAction('auth', 'logout'), context: context() }).allowed,
    ).toBe(false);
  });

  test('a public action needs no rule, but still admits only its principal kinds', () => {
    const open: AuthorizedAction = {
      ...moduleAction('app', 'health', { auth: 'public' }),
      principal: ['user'],
    };
    expect(evaluateGate({ rules: [], action: open, context: context() }).allowed).toBe(true);
    expect(evaluateGate({ rules: [], action: open, context: context('service') }).allowed).toBe(
      false,
    );
  });

  test('scope level: deployment actions need an operator at the deployment level', () => {
    const action = moduleAction('core', 'tenants', { scope: 'deployment' });
    const rules = [rule({ id: 'core.ops', effect: 'allow', entity: 'core', actions: ['tenants'] })];
    const operator = context('operator');
    const atDeployment = { ...operator, scope: { level: 'deployment' } } as typeof operator;
    expect(evaluateGate({ rules, action, context: atDeployment }).allowed).toBe(true);
    expect(evaluateGate({ rules, action, context: operator }).allowed).toBe(false);
    const user = { ...context(), scope: { level: 'deployment' } } as typeof operator;
    expect(evaluateGate({ rules, action, context: user }).allowed).toBe(false);
  });

  test('scope level: a backend action is reachable from the backend and its tenants only', () => {
    const action = moduleAction('app', 'config', { scope: 'backend' });
    const rules = [rule({ id: 'app.cfg', effect: 'allow', entity: 'app', actions: ['config'] })];
    expect(evaluateGate({ rules, action, context: context() }).allowed).toBe(true);
    const base = context();
    const backend = { ...base, scope: { level: 'backend', backendId: 'b1' } } as typeof base;
    expect(evaluateGate({ rules, action, context: backend }).allowed).toBe(true);
    const wrongBackend = { ...base, scope: { level: 'backend', backendId: 'b2' } } as typeof base;
    expect(evaluateGate({ rules, action, context: wrongBackend }).allowed).toBe(false);
  });

  test('a principal resolved in another tenant does not act in this one', () => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['read'] })];
    const base = context();
    const elsewhere = {
      ...base,
      scope: { level: 'tenant', backendId: 'b1', tenantId: 't2' },
    } as typeof base;
    expect(evaluateGate({ rules, action: read, context: elsewhere }).allowed).toBe(false);
  });

  test('a disabled rule is out', () => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['read'], disabled: true })];
    expect(evaluateGate({ rules, action: read, context: context() }).allowed).toBe(false);
  });

  test('a selector rule covers actions across modules, by kind and transport', () => {
    const selector = rule({
      id: 'app.read-only-key',
      effect: 'deny',
      subject: { kinds: ['command'], transports: ['rest'] },
      actions: ['*'],
      reason: 'Read-only.',
    });
    const allow = rule({ id: 'a', effect: 'allow', actions: ['*'] });
    const update = entityAction('update', { generated: 'update' });
    const rules = [allow, selector];
    expect(
      evaluateGate({ rules, action: update, context: context(), transport: 'rest' }).allowed,
    ).toBe(false);
    expect(
      evaluateGate({ rules, action: update, context: context(), transport: 'graphql' }).allowed,
    ).toBe(true);
    expect(
      evaluateGate({ rules, action: read, context: context(), transport: 'rest' }).allowed,
    ).toBe(true);
    // an unknown transport still meets a deny
    expect(evaluateGate({ rules, action: update, context: context() }).allowed).toBe(false);
  });

  test('a batch set passes when one of its operations can', () => {
    const set = entityAction('set', { generated: 'set' });
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['archive'] })];
    expect(evaluateGate({ rules, action: set, context: context() }).allowed).toBe(true);
    expect(evaluateGate({ rules: [], action: set, context: context() }).allowed).toBe(false);
  });

  test('a deny that covers everything stops a public action too', () => {
    const signUp = moduleAction('accounts', 'signUp', { auth: 'public' });
    const freeze = rule({
      id: 'freeze',
      effect: 'deny',
      subject: { kinds: ['command'] },
      actions: ['*'],
      reason: 'Tenant frozen.',
    });
    expect(evaluateGate({ rules: [], action: signUp, context: context('anonymous') }).allowed).toBe(
      true,
    );
    expect(
      evaluateGate({ rules: [freeze], action: signUp, context: context('anonymous') }),
    ).toEqual({
      allowed: false,
      rules: [{ id: 'freeze', effect: 'deny' }],
      reason: 'Tenant frozen.',
    });
  });

  test('system principals do not reach deployment-scope actions', () => {
    const action = moduleAction('core', 'tenants', { scope: 'deployment' });
    const rules = [rule({ id: 'core.ops', effect: 'allow', entity: 'core', actions: ['tenants'] })];
    const system = { ...context('system'), scope: { level: 'deployment' } } as ReturnType<
      typeof context
    >;
    expect(evaluateGate({ rules, action, context: system }).allowed).toBe(false);
  });

  test('a create is judged by check ?? where, as its plan is', () => {
    const create = entityAction('create', { generated: 'create' });
    const rules = [
      rule({
        id: 'a',
        effect: 'allow',
        actions: ['create'],
        where: () => false,
        check: () => ({ status: 'draft' }),
      }),
    ];
    expect(evaluateGate({ rules, action: create, context: context() }).allowed).toBe(true);
    const never = [
      rule({
        id: 'n',
        effect: 'allow',
        actions: ['create'],
        where: () => true,
        check: () => false,
      }),
    ];
    expect(evaluateGate({ rules: never, action: create, context: context() }).allowed).toBe(false);
  });
});
