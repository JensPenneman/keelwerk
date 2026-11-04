import { describe, expect, test } from 'vitest';
import { entityAction, rule, ruleEntry } from '../../test/authorization/fixtures.ts';
import { actionMatches } from './action-matches.ts';
import { expandActionAliases } from './expand-action-aliases.ts';
import { itemAction } from './item-action.ts';
import { normalizeRule } from './normalize-rule.ts';
import { operationOf } from './operation-of.ts';
import { ruleApplies } from './rule-applies.ts';

describe('expandActionAliases', () => {
  test.each([
    [['read'], 'get', true],
    [['read'], 'history', true],
    [['read'], 'watch', true],
    [['read'], 'update', false],
    [['write'], 'create', true],
    [['write'], 'set', true],
    [['write'], 'query', false],
    [['set'], 'archive', true],
    [['*'], 'anything', true],
    [['revoke'], 'revoke', true],
    [['revoke'], 'update', false],
  ])('%j covers %s: %s', (actions, name, expected) => {
    const generated = [
      'get',
      'history',
      'watch',
      'create',
      'set',
      'update',
      'archive',
      'query',
    ].includes(name);
    const action = entityAction(name, {
      ...(generated && { generated: name as 'get' }),
      kind: ['get', 'history', 'watch', 'query'].includes(name) ? 'query' : 'command',
    });
    expect(actionMatches(expandActionAliases(actions), action)).toBe(expected);
  });

  test('read covers a custom query of the entity but not of another module', () => {
    const search = entityAction('search', { kind: 'query' });
    expect(actionMatches(expandActionAliases(['read']), search)).toBe(true);
    const custom = entityAction('promote', { kind: 'command' });
    expect(actionMatches(expandActionAliases(['read']), custom)).toBe(false);
  });
});

describe('ruleApplies', () => {
  test('an entity rule covers its own entity only', () => {
    const own = rule({ id: 'a', effect: 'allow', entity: 'doc.post', actions: ['*'] });
    expect(ruleApplies(own, entityAction('get', { generated: 'get' }), 'user', null)).toBe(true);
    expect(
      ruleApplies(own, entityAction('get', { generated: 'get', entity: 'doc.page' }), 'user', null),
    ).toBe(false);
  });

  test('principal kinds restrict a rule', () => {
    const only = rule({ id: 'a', effect: 'allow', principal: ['user', 'service'] });
    const action = entityAction('get', { generated: 'get' });
    expect(ruleApplies(only, action, 'service', null)).toBe(true);
    expect(ruleApplies(only, action, 'operator', null)).toBe(false);
  });
});

describe('normalizeRule', () => {
  test('a deny rule needs a reason', () => {
    expect(() => normalizeRule(ruleEntry({ id: 'd', effect: 'deny' }))).toThrow(
      expect.objectContaining({
        code: 'core.internal',
        details: expect.objectContaining({ code: 'denyWithoutReason' }),
      }),
    );
  });

  test('a rule is resolved to a target, a principal set and a field set', () => {
    const resolved = normalizeRule(
      ruleEntry({
        id: 'a',
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        fields: ['secret'],
      }),
    );
    expect(resolved.target).toEqual({ kind: 'entity', ref: 'doc.post' });
    expect([...(resolved.principals ?? [])]).toEqual(['user']);
    expect([...(resolved.fields ?? [])]).toEqual(['secret']);
  });
});

describe('operationOf and itemAction', () => {
  test.each([
    ['get', { generated: 'get' as const }, 'read'],
    ['search', { kind: 'query' as const }, 'read'],
    ['create', { generated: 'create' as const }, 'create'],
    ['update', { generated: 'update' as const }, 'transition'],
    ['archive', { generated: 'archive' as const }, 'transition'],
    ['revoke', { kind: 'command' as const, instance: true }, 'transition'],
  ])('%s is a %s', (name, options, operation) => {
    expect(operationOf(entityAction(name, options))).toBe(operation);
  });

  test('a batch has no operation; its items do', () => {
    const set = entityAction('set', { generated: 'set' });
    expect(() => operationOf(set)).toThrow(/each item/);
    const item = itemAction(set, 'update');
    expect(item).toMatchObject({
      ref: 'doc.post.update',
      name: 'update',
      generated: 'update',
      instance: true,
    });
    expect(operationOf(item)).toBe('transition');
    expect(operationOf(itemAction(set, 'create'))).toBe('create');
  });
});
