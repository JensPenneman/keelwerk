import { describe, expect, test } from 'vitest';
import { context, entityAction, rule, ruleEntry } from '../../test/authorization/fixtures.ts';
import { post, subjectOf } from '../../test/authorization/post-fixture.ts';
import { toWire } from '../errors/to-wire.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { allOf } from './all-of.ts';
import { anyOf } from './any-of.ts';
import { compilePlan } from './compile-plan.ts';
import { createAbility } from './create-ability.ts';
import { decisionLog } from './decision-log.ts';
import type { DecisionLogEntry } from './decision-log-entry.ts';
import { explainPlan } from './explain-plan.ts';
import { forbiddenError } from './forbidden-error.ts';
import { negate } from './negate.ts';
import { createPlanMemo } from './plan-memo.ts';

function actionEntry(name: string, generated?: ActionEntry['generated']): ActionEntry {
  return {
    ...entityAction(name, generated === undefined ? {} : { generated }),
  } as unknown as ActionEntry;
}

const rules = [
  ruleEntry({ id: 'doc.post.read', effect: 'allow', actions: ['read'] }),
  ruleEntry({
    id: 'doc.post.edit',
    effect: 'allow',
    actions: ['update'],
    where: (ctx) => ({ ownerId: subjectOf(ctx as never) }),
  }),
];
const registry = {
  actions: new Map<string, ActionEntry>([
    ['doc.post.get', actionEntry('get', 'get')],
    ['doc.post.update', actionEntry('update', 'update')],
    ['doc.post.archive', actionEntry('archive', 'archive')],
    ['doc.post.set', actionEntry('set', 'set')],
  ]),
  entities: new Map([['doc.post', { ref: 'doc.post', descriptor: post } as EntityEntry]]),
  rules: new Map(rules.map((r) => [r.id, r])),
} satisfies Pick<Registry, 'actions' | 'entities' | 'rules'>;

describe('createAbility', () => {
  test('can answers from the gate and the plan', () => {
    const ability = createAbility({ registry, context: context() });
    expect(ability.can('doc.post.get')).toBe(true);
    expect(ability.can('doc.post.update')).toBe(true);
    expect(ability.can('doc.post.archive')).toBe(false);
    expect(ability.can('doc.post.set')).toBe(true);
    expect(ability.can('doc.post.unknown')).toBe(false);
  });

  test('canFilterBy asks whether a maskable field is revealed for every row the read plan selects', () => {
    const revealing = [
      ruleEntry({ id: 'doc.post.reveal', effect: 'allow', actions: ['read'], fields: ['title'] }),
    ];
    const narrow = createAbility({
      registry: { ...registry, rules: new Map(revealing.map((r) => [r.id, r])) },
      context: context(),
    });
    expect(narrow.canFilterBy('doc.post.get', 'title')).toBe(true);
    expect(narrow.canFilterBy('doc.post.get', 'note')).toBe(false);
    const open = createAbility({ registry, context: context() });
    expect(open.canFilterBy('doc.post.get', 'note')).toBe(true);
    expect(open.canFilterBy('doc.post.archive', 'note')).toBe(false);
    // A command's own rules grant no read, so a command never answers a filter or sort question.
    expect(open.can('doc.post.update')).toBe(true);
    expect(open.canFilterBy('doc.post.update', 'note')).toBe(false);
    expect(open.canFilterBy('doc.post.unknown', 'note')).toBe(false);
  });

  test('an action of an entity the registry does not hold cannot be done', () => {
    const ghost = entityAction('get', { generated: 'get', entity: 'doc.ghost' });
    const orphan = new Map(registry.actions).set(ghost.ref, ghost as unknown as ActionEntry);
    const ability = createAbility({
      registry: { ...registry, actions: orphan },
      context: context(),
    });
    expect(ability.can(ghost.ref)).toBe(false);
  });

  test('an anonymous caller owns no row, so the edit plan is never', () => {
    const ability = createAbility({ registry, context: context('anonymous') });
    expect(ability.can('doc.post.get')).toBe(true);
    expect(ability.can('doc.post.update')).toBe(false);
  });

  test('plan and explain render the resolved condition', () => {
    const ability = createAbility({ registry, context: context() });
    const plan = ability.plan('doc.post.update');
    expect(plan?.kind).toBe('conditional');
    expect(plan === undefined ? '' : ability.explain(plan)).toBe(
      [
        'doc.post.update on doc.post: conditional (transition)',
        '  selects ownerId = "u1"',
        '  allow doc.post.edit: where ownerId = "u1"',
        '  maskable: secret, note',
      ].join('\n'),
    );
  });
});

describe('plan memo', () => {
  test('one compile per action within an invocation', () => {
    const memo = createPlanMemo();
    const action = entityAction('get', { generated: 'get' });
    let compiled = 0;
    const compile = () => {
      compiled += 1;
      return compilePlan({
        rules: [rule({ id: 'a', effect: 'allow' })],
        action,
        entity: post,
        context: context(),
      });
    };
    expect(memo.plan(action, compile)).toBe(memo.plan(action, compile));
    expect(compiled).toBe(1);
    expect(memo.size).toBe(1);
  });
});

describe('decision log', () => {
  const entry = (allowed: boolean): DecisionLogEntry => ({
    stage: 'gate',
    action: 'doc.post.get',
    allowed,
    rules: [],
    principal: { kind: 'user', via: 'test' },
  });

  test.each([
    ['all', [true, false]],
    ['denials', [false]],
    ['none', []],
  ] as const)('%s', (mode, expected) => {
    const seen: boolean[] = [];
    for (const allowed of [true, false])
      decisionLog(mode, (e) => seen.push(e.allowed), entry(allowed));
    expect(seen).toEqual(expected);
  });
});

describe('forbiddenError', () => {
  test('carries the deny reason and the rule ids; the public wire shows the reason only', () => {
    const error = forbiddenError({
      action: 'doc.post.update',
      reason: 'Frozen.',
      rules: [{ id: 'doc.post.frozen', effect: 'deny' }],
    });
    expect(error).toMatchObject({
      kind: 'forbidden',
      code: 'core.forbidden',
      reason: 'Frozen.',
      message: 'Frozen.',
    });
    expect(toWire(error, 'public')).toMatchObject({ reason: 'Frozen.' });
    expect(toWire(error, 'public').rules).toBeUndefined();
    expect(toWire(error, 'operator').rules).toEqual([{ id: 'doc.post.frozen', effect: 'deny' }]);
  });

  test('without a deny, the allows that would have had to hold', () => {
    const error = forbiddenError({
      action: 'doc.post.update',
      rules: [{ id: 'doc.post.edit', effect: 'allow' }],
    });
    expect(error.reason).toBeUndefined();
    expect(error.rules).toEqual([{ id: 'doc.post.edit', effect: 'allow' }]);
  });
});

describe('condition algebra', () => {
  const a = { op: 'eq', field: 'a', value: 1 } as const;
  const b = { op: 'eq', field: 'b', value: 2 } as const;
  const always = { op: 'and', conditions: [] } as const;
  const never = { op: 'never' } as const;

  test('allOf and anyOf simplify', () => {
    expect(allOf([])).toEqual(always);
    expect(allOf([a, always])).toBe(a);
    expect(allOf([a, never])).toEqual(never);
    expect(allOf([a, { op: 'and', conditions: [b] }])).toEqual({ op: 'and', conditions: [a, b] });
    expect(anyOf([])).toEqual(never);
    expect(anyOf([a, never])).toBe(a);
    expect(anyOf([a, always])).toEqual(always);
    expect(anyOf([a, b])).toEqual({ op: 'or', conditions: [a, b] });
  });

  test('negate', () => {
    expect(negate(always)).toEqual(never);
    expect(negate(never)).toEqual(always);
    expect(negate(negate(a))).toBe(a);
  });

  test('explainPlan of a never plan', () => {
    const plan = compilePlan({
      rules: [],
      action: entityAction('get', { generated: 'get' }),
      entity: post,
      context: context(),
    });
    expect(explainPlan(plan).split('\n')[0]).toBe('doc.post.get on doc.post: never (read)');
  });
});
