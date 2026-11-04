import { describe, expect, test } from 'vitest';
import { context, entityAction, rule } from '../../test/authorization/fixtures.ts';
import { post, subjectOf } from '../../test/authorization/post-fixture.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { checkItem } from './check-item.ts';
import { compilePlan } from './compile-plan.ts';
import type { NormalizedRule } from './normalized-rule.ts';

describe('reads', () => {
  const action = entityAction('query', { generated: 'query' });
  const plan = (rules: readonly NormalizedRule[], ctx = context()) =>
    compilePlan({ rules, action, entity: post, context: ctx });

  test('default deny: no rule, no access', () => {
    expect(plan([]).kind).toBe('never');
  });

  test('an unconditional allow is always', () => {
    expect(plan([rule({ id: 'a', effect: 'allow', actions: ['read'] })]).kind).toBe('always');
  });

  test('allows are or-ed, denies override', () => {
    const rules = [
      rule({
        id: 'own',
        effect: 'allow',
        actions: ['read'],
        where: (c) => ({ ownerId: subjectOf(c) }),
      }),
      rule({
        id: 'pub',
        effect: 'allow',
        actions: ['read'],
        where: () => ({ status: 'published' }),
      }),
      rule({
        id: 'frozen',
        effect: 'deny',
        actions: ['read'],
        where: () => ({ status: 'trashed' }),
        reason: 'Trashed.',
      }),
    ];
    const compiled = plan(rules);
    expect(compiled.kind).toBe('conditional');
    const visible = (row: StorageRow) => checkItem(compiled, { pre: row }).allowed;
    expect(visible({ id: 'x', ownerId: 'u1', status: 'draft' })).toBe(true);
    expect(visible({ id: 'x', ownerId: 'u9', status: 'published' })).toBe(true);
    expect(visible({ id: 'x', ownerId: 'u9', status: 'draft' })).toBe(false);
    const trashed = checkItem(compiled, { pre: { id: 'x', ownerId: 'u1', status: 'trashed' } });
    expect(trashed.allowed).toBe(false);
    expect(trashed.reason).toBe('Trashed.');
  });

  test('an unconditional deny makes the plan never and carries its reason', () => {
    const compiled = plan([
      rule({ id: 'a', effect: 'allow', actions: ['read'] }),
      rule({ id: 'd', effect: 'deny', actions: ['read'], reason: 'Frozen tenant.' }),
    ]);
    expect(compiled.kind).toBe('never');
    expect(compiled.reason).toBe('Frozen tenant.');
  });

  test('null never matches: an anonymous caller does not match an owner rule, even on unowned rows', () => {
    const rules = [
      rule({
        id: 'own',
        effect: 'allow',
        actions: ['read'],
        where: (c) => ({ ownerId: subjectOf(c) }),
      }),
    ];
    const compiled = plan(rules, context('anonymous'));
    expect(compiled.kind).toBe('never');
    expect(checkItem(compiled, { pre: { id: 'x', ownerId: null } }).allowed).toBe(false);
  });

  test('a null inside an in list is a rule error, never a silent no-match', () => {
    const rules = [
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['read'],
        where: () => ({ status: { in: ['a', undefined] } }),
        reason: 'x',
      }),
    ];
    expect(() => plan(rules)).toThrow(expect.objectContaining({ code: 'core.internal' }));
  });

  test('a rule that returns a boolean', () => {
    expect(
      plan([rule({ id: 'a', effect: 'allow', actions: ['read'], where: () => false })]).kind,
    ).toBe('never');
    expect(
      plan([rule({ id: 'a', effect: 'allow', actions: ['read'], where: () => true })]).kind,
    ).toBe('always');
  });

  test('a rule principal narrows the kinds it covers', () => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['read'], principal: 'user' })];
    expect(plan(rules).kind).toBe('always');
    expect(plan(rules, context('service')).kind).toBe('never');
    expect(plan(rules, context('anonymous')).kind).toBe('never');
  });

  test('a custom query over the entity is a read', () => {
    const search = entityAction('search', { kind: 'query' });
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['read'] })];
    expect(compilePlan({ rules, action: search, entity: post, context: context() }).kind).toBe(
      'always',
    );
  });
});

describe('field lists', () => {
  const update = entityAction('update', { generated: 'update' });
  const plan = (rules: readonly NormalizedRule[]) =>
    compilePlan({ rules, action: update, entity: post, context: context() });

  test('writes change only the fields the selecting allows list', () => {
    const compiled = plan([
      rule({ id: 'a', effect: 'allow', actions: ['update'], fields: ['title'] }),
    ]);
    const result = checkItem(compiled, {
      pre: { id: 'p' },
      post: { id: 'p' },
      changed: ['title', 'status'],
    });
    expect(result.allowed).toBe(false);
    expect(result.forbiddenFields).toEqual(['status']);
    const stripped = checkItem(compiled, {
      pre: { id: 'p' },
      post: { id: 'p' },
      changed: ['title', 'status'],
      mode: 'strip',
    });
    expect(stripped.allowed).toBe(true);
    expect(stripped.forbiddenFields).toEqual(['status']);
  });

  test('an allow without a field list covers every field; a deny with a field list takes one out', () => {
    const compiled = plan([
      rule({ id: 'a', effect: 'allow', actions: ['update'] }),
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['update'],
        fields: ['status'],
        reason: 'Locked field.',
      }),
    ]);
    const result = checkItem(compiled, {
      pre: { id: 'p' },
      post: { id: 'p' },
      changed: ['title', 'status'],
    });
    expect(result.forbiddenFields).toEqual(['status']);
    expect(compiled.kind).toBe('always');
  });
});
