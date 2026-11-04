import { describe, expect, test } from 'vitest';
import { rule, ruleEntry } from '../../test/authorization/fixtures.ts';
import { post } from '../../test/authorization/post-fixture.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { applyPolicyOverrides } from './apply-policy-overrides.ts';
import { checkRuleCondition } from './check-rule-condition.ts';
import { ruleProblems } from './rule-problems.ts';

const registry = {
  actions: new Map([['doc.post.publish', {} as ActionEntry]]),
  entities: new Map([['doc.post', { ref: 'doc.post', descriptor: post } as EntityEntry]]),
};

describe('ruleProblems', () => {
  test('a clean rule has none', () => {
    const entry = ruleEntry({
      id: 'a',
      effect: 'allow',
      actions: ['read', 'publish'],
      fields: ['secret'],
    });
    expect(ruleProblems(entry, registry)).toEqual([]);
  });

  test('unknownRuleActions names a custom action the target does not mount', () => {
    const entry = ruleEntry({ id: 'a', effect: 'allow', actions: ['publish', 'frobnicate'] });
    expect(ruleProblems(entry, registry).map((p) => [p.code, p.ref])).toEqual([
      ['unknownRuleActions', 'a'],
    ]);
    expect(ruleProblems(entry, registry)[0]?.message).toContain('"frobnicate"');
  });

  test('a read rule lists maskable fields only; a write rule may list any', () => {
    const read = ruleEntry({ id: 'r', effect: 'allow', actions: ['read'], fields: ['title'] });
    expect(ruleProblems(read, registry).map((p) => p.code)).toEqual(['nonMaskableRuleField']);
    const write = ruleEntry({ id: 'w', effect: 'allow', actions: ['publish'], fields: ['title'] });
    expect(ruleProblems(write, registry)).toEqual([]);
  });

  test('a deny rule carries a reason', () => {
    const entry = ruleEntry({ id: 'd', effect: 'deny', actions: ['read'] });
    expect(ruleProblems(entry, registry).map((p) => p.code)).toEqual(['denyWithoutReason']);
  });
});

describe('applyPolicyOverrides', () => {
  const a = ruleEntry({ id: 'doc.post.a', effect: 'allow', actions: ['read'] });
  const b = ruleEntry({ id: 'doc.post.b', effect: 'allow', actions: ['publish'] });
  const other = ruleEntry({
    id: 'mail.box.c',
    effect: 'allow',
    entity: 'mail.box',
    actions: ['read'],
  });

  test('disable keeps the rule in the list, switched off', () => {
    const result = applyPolicyOverrides([a, b], { disable: ['doc.post.a'] }, registry);
    expect(result.problems).toEqual([]);
    expect(result.rules.map((r) => [r.id, r.disabled])).toEqual([
      ['doc.post.a', true],
      ['doc.post.b', false],
    ]);
  });

  test('a disable naming no rule is a compose error', () => {
    const result = applyPolicyOverrides([a], { disable: ['doc.post.nope'] }, registry);
    expect(result.problems.map((p) => [p.code, p.severity, p.ref])).toEqual([
      ['unknownDisabledRule', 'error', 'doc.post.nope'],
    ]);
  });

  test('add appends app rules and checks them', () => {
    const extra = ruleEntry({ id: 'app.extra', effect: 'deny', actions: ['read'] });
    const result = applyPolicyOverrides([a], { add: [extra] }, registry);
    expect(result.rules.map((r) => r.id)).toEqual(['doc.post.a', 'app.extra']);
    expect(result.problems.map((p) => p.code)).toEqual(['denyWithoutReason']);
    const duplicate = applyPolicyOverrides([a], { add: [a] }, registry);
    expect(duplicate.problems.map((p) => p.code)).toEqual(['duplicateRuleId']);
  });

  test('replace swaps a module rule set wholesale', () => {
    const replacement = ruleEntry({ id: 'app.doc-rules', effect: 'allow', actions: ['read'] });
    const result = applyPolicyOverrides(
      [a, b, other],
      { replace: { doc: [replacement] } },
      registry,
    );
    expect(result.problems).toEqual([]);
    expect(result.rules.map((r) => [r.id, r.disabled])).toEqual([
      ['doc.post.a', true],
      ['doc.post.b', true],
      ['mail.box.c', false],
      ['app.doc-rules', false],
    ]);
    expect(
      applyPolicyOverrides([a], { replace: { nope: [] } }, registry).problems.map((p) => p.code),
    ).toEqual(['unknownReplacedModule']);
  });
});

describe('checkRuleCondition', () => {
  test('a name the entity does not have is unknownConditionFields', () => {
    expect(() => checkRuleCondition('r', post, { op: 'eq', field: 'owner', value: 1 })).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ code: 'unknownConditionFields' }),
      }),
    );
    expect(() =>
      checkRuleCondition('r', post, { op: 'some', relation: 'ghosts', where: { op: 'never' } }),
    ).toThrow(/ghosts/);
    expect(() => checkRuleCondition('r', post, { op: 'eq', field: 'hidden', value: 'x' })).toThrow(
      /hidden/,
    );
    expect(() =>
      checkRuleCondition('r', post, { op: 'eq', field: 'id', value: 'x' }),
    ).not.toThrow();
  });

  test.each([
    ['eq', 'email', true],
    ['in', 'email', true],
    ['isNull', 'email', true],
    ['startsWith', 'email', false],
    ['startsWith', 'nickname', true],
    ['eq', 'nickname', false],
    ['contains', 'bio', false],
    ['gt', 'email', false],
  ])('%s on the personal field %s: %s', (op, field, ok) => {
    const condition = { op, field, value: op === 'in' ? ['a'] : 'a' } as Parameters<
      typeof checkRuleCondition
    >[2];
    const run = () => checkRuleCondition('r', post, condition);
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(expect.objectContaining({ code: 'core.personal_operator' }));
  });

  test('the rule helper builds normalised rules', () => {
    expect(rule({ id: 'x', effect: 'allow' }).id).toBe('x');
  });
});
