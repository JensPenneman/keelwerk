import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { appOf, command, makeModule, shop } from '../../test/registry-kit.ts';
import { contracts } from '../dsl/contracts.ts';
import { defineApp } from '../dsl/define-app.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from './build-registry.ts';

const fullApp = defineApp({ id: 'full', modules: [accounts, teams, auth, hooks] });
const alone = defineApp({ id: 'alone', modules: [auth] });
const noTeams = defineApp({ id: 'no-teams', modules: [accounts, auth] });
const overridden = defineApp({
  id: 'overridden',
  modules: [accounts, auth],
  execution: { 'auth.credential.revoke': 'async', 'accounts.profile.update': 'either' },
  policies: { disable: ['accounts.profile.operator'] },
});
const full = buildRegistry(fullApp);

describe('the registry (section 3.3)', () => {
  test('lists the modules in topological order, with the tuple as the tie-break', () => {
    expect(full.modules.map((module) => [module.order, module.id])).toEqual([
      [0, 'core'],
      [1, 'accounts'],
      [2, 'teams'],
      [3, 'auth'],
      [4, 'hooks'],
    ]);
    const first = makeModule({ id: 'first' });
    const second = makeModule({ id: 'second', requires: [first] });
    const third = makeModule({ id: 'third' });
    const order = (modules: readonly AnyModule[]): readonly string[] =>
      buildRegistry(appOf(modules)).modules.map((module) => module.id);
    expect(order([second, third, first])).toEqual(['core', 'third', 'first', 'second']);
    expect(order([first, second, third])).toEqual(['core', 'first', 'second', 'third']);
  });

  test('puts an optional module that is present, and the provider of a contract, first', () => {
    const live = makeModule({ id: 'live', provides: [contracts.live] });
    const user = makeModule({ id: 'user', requires: [contracts.live], optional: [shop] });
    const modules = buildRegistry(appOf([user, shop, live])).modules.map((module) => module.id);
    expect(modules).toEqual(['core', 'shop', 'live', 'user']);
  });

  test('every map iterates in code point order of its keys', () => {
    for (const map of [full.entities, full.actions, full.rules, full.extensionPoints, full.fills]) {
      const keys = [...map.keys()];
      expect(keys).toEqual(keys.toSorted());
    }
  });

  test('describes each module: context name, dependencies, contracts and what it owns', () => {
    const live = makeModule({ id: 'mail-live', provides: [contracts.live] });
    const user = makeModule({ id: 'mail-user', requires: [live], optional: [contracts.live] });
    const entries = buildRegistry(appOf([live, user])).modules;
    expect(entries.find((module) => module.id === 'mail-user')).toMatchObject({
      contextName: 'mailUser',
      requires: ['mail-live'],
      needs: ['live'],
    });
    expect(entries.find((module) => module.id === 'mail-live')?.provides).toEqual(['live']);
    const accountsEntry = full.modules.find((module) => module.id === 'accounts');
    expect(accountsEntry?.entities).toEqual(['accounts.profile']);
    expect(accountsEntry?.extensionPoints).toEqual(['accounts.identityProviders']);
    expect(accountsEntry?.services).toEqual(['accounts.findByEmail']);
    const authEntry = full.modules.find((module) => module.id === 'auth');
    expect(authEntry?.actions).toContain('accounts.profile.resetPassword');
    expect(authEntry?.actions).not.toContain('accounts.profile.get');
  });
});

describe('contributions and conditional parts (sections 5.3 and 5.4)', () => {
  test('are applied when the target and the when modules are selected', () => {
    expect(full.contributions.map((part) => [part.id, part.active])).toEqual([
      ['auth->accounts', true],
      ['auth->accounts[teams]', true],
    ]);
    expect(full.actions.has('auth.linkProfile')).toBe(true);
    expect(full.entities.get('auth.credential')?.descriptor.fields.profileId).toBeDefined();
  });

  test('a contribution whose when module is absent is dropped for that reason', () => {
    const entries = buildRegistry(noTeams).contributions;
    expect(entries.map((part) => [part.id, part.active, part.droppedBecause])).toEqual([
      ['auth->accounts', true, undefined],
      ['auth->accounts[teams]', false, 'whenUnsatisfied'],
    ]);
    expect(buildRegistry(noTeams).entities.get('accounts.profile')?.origin).not.toHaveProperty(
      'defaultTeamName',
    );
  });

  test('a contribution whose target is absent is dropped for that reason, with its parts', () => {
    const registry = buildRegistry(alone);
    expect(
      registry.contributions.map((part) => [part.id, part.active, part.droppedBecause]),
    ).toEqual([
      ['auth->accounts', false, 'targetAbsent'],
      ['auth->accounts[teams]', false, 'targetAbsent'],
    ]);
    expect(registry.actions.has('accounts.whoami')).toBe(false);
    expect(registry.actions.has('auth.linkProfile')).toBe(false);
    expect(registry.entities.get('auth.credential')?.descriptor.fields.profileId).toBeUndefined();
    expect([...registry.rules.keys()]).toEqual([
      'auth.credential.self',
      'auth.login.open',
      'core.composition.operators',
      'core.introspect.signedIn',
    ]);
  });

  test('a conditional part keyed on a contract is present only when a module provides it', () => {
    const live = makeModule({ id: 'live', provides: [contracts.live] });
    const withoutLive = defineApp({ id: 'without', modules: [auth] });
    const without = buildRegistry(withoutLive);
    expect(without.actions.has('auth.sessionEvents')).toBe(false);
    const withLive = buildRegistry(appOf([auth, live]));
    expect(withLive.actions.get('auth.sessionEvents')).toMatchObject({
      kind: 'subscription',
      contributedBy: 'auth',
    });
  });

  test('a reaction of a conditional part names the modules that activate it', () => {
    expect(full.reactions.get('auth.revokeOnDeactivation')).toMatchObject({
      module: 'auth',
      on: ['accounts.profile.deactivated'],
      timing: 'inline',
      when: ['accounts'],
      contributedBy: 'auth',
    });
  });
});

describe('the action table (section 16.2.2)', () => {
  test('mounts module, entity, contributed, conditional, generated and core actions', () => {
    expect(full.actions.get('accounts.register')).toMatchObject({
      mount: 'module',
      instance: false,
    });
    expect(full.actions.get('accounts.profile.deactivate')).toMatchObject({
      mount: 'entity',
      entity: 'accounts.profile',
      instance: true,
      kind: 'command',
    });
    expect(full.actions.get('accounts.whoami')).toMatchObject({ contributedBy: 'auth' });
    expect(full.actions.get('accounts.profile.get')).toMatchObject({
      generated: 'get',
      kind: 'query',
      idempotent: true,
    });
    expect(full.actions.get('accounts.profile.update')).toMatchObject({
      generated: 'update',
      kind: 'command',
      instance: true,
      since: '2026-11-04',
    });
    expect(full.actions.get('core.introspect')).toMatchObject({ scope: 'backend', kind: 'query' });
  });

  test('app actions are mounted under app', () => {
    const health = command();
    const registry = buildRegistry(appOf([shop], { appActions: { health } as never }));
    expect(registry.actions.get('app.health')).toMatchObject({ module: 'app', mount: 'app' });
  });

  test('the core entities have their generated create (S-26) and none the sets they switch off', () => {
    expect(full.actions.has('core.backend.create')).toBe(true);
    expect(full.actions.has('core.tenant.create')).toBe(true);
    expect(full.actions.get('core.tenant.create')).toMatchObject({ scope: 'deployment' });
    expect(full.actions.has('core.commandReceipt.create')).toBe(false);
    expect(full.actions.has('core.domain.update')).toBe(false);
    expect(full.entities.get('core.commandReceipt')?.generated).toEqual([
      'get',
      'query',
      'changes',
      'queryChanges',
    ]);
  });

  test('the execution overrides decide the effective mode of custom and generated commands', () => {
    const registry = buildRegistry(overridden);
    expect(registry.actions.get('auth.credential.revoke')?.execution).toBe('async');
    expect(registry.actions.get('accounts.profile.update')?.execution).toBe('either');
    expect(registry.actions.get('accounts.profile.create')?.execution).toBe('sync');
  });

  test('entity commands take an id and an optional ifVersion beside their input', () => {
    const input = full.actions.get('accounts.profile.deactivate')?.input as unknown as {
      readonly fields: object;
    };
    expect(Object.keys(input.fields)).toEqual(expect.arrayContaining(['id', 'ifVersion']));
  });

  test('declared errors are listed by code, sorted', () => {
    expect(full.actions.get('accounts.register')?.errors).toEqual([
      'accounts.email_taken',
      'accounts.registration_disabled',
    ]);
  });
});

describe('rules (section 8.1)', () => {
  test('ids come from where the rule is mounted', () => {
    expect([...full.rules.keys()]).toEqual([
      'accounts.profile.operator',
      'accounts.register.open',
      'auth.accounts.profile.self',
      'auth.credential.self',
      'auth.login.open',
      'core.composition.operators',
      'core.introspect.signedIn',
    ]);
    expect(full.rules.get('auth.accounts.profile.self')).toMatchObject({
      module: 'auth',
      contributedBy: 'auth',
      subject: { module: 'accounts', entity: 'profile' },
      actions: ['read'],
      fields: ['email', 'lastLoginAt'],
      principal: 'user',
    });
    expect(full.rules.get('accounts.register.open')).toMatchObject({
      subject: { module: 'accounts' },
      actions: ['register'],
    });
  });

  test('policies.disable marks a rule disabled and keeps it in the set', () => {
    const registry = buildRegistry(overridden);
    expect(registry.rules.get('accounts.profile.operator')?.disabled).toBe(true);
    expect(registry.rules.get('auth.credential.self')?.disabled).toBe(false);
  });
});
