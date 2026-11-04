import { describe, expect, test } from 'vitest';
import { context, entityAction, rule } from '../../test/authorization/fixtures.ts';
import { post, subjectOf } from '../../test/authorization/post-fixture.ts';
import { checkFilterFields } from './check-filter-fields.ts';
import { checkRowInPlan } from './check-row-in-plan.ts';
import { compilePlan } from './compile-plan.ts';
import { createRowMatcher } from './create-row-matcher.ts';
import type { DroppedRow } from './dropped-row.ts';
import { maskRow } from './mask-row.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { plainRowMatcher } from './plain-row-matcher.ts';

const query = entityAction('query', { generated: 'query' });
const planOf = (rules: readonly NormalizedRule[]) =>
  compilePlan({ rules, action: query, entity: post, context: context() });
const row = { id: 'p1', ownerId: 'u1', title: 't', secret: 's', note: 'n' };

describe('maskRow', () => {
  test('an allow that lists no fields reveals every maskable field', () => {
    const plan = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'] })]);
    expect(maskRow(plan, row, plainRowMatcher())).toBe(row);
  });

  test('an allow with a list reveals only those, and $masked names the rest', () => {
    const plan = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'], fields: ['note'] })]);
    expect(maskRow(plan, row, plainRowMatcher())).toEqual({
      id: 'p1',
      ownerId: 'u1',
      title: 't',
      note: 'n',
      $masked: ['secret'],
    });
  });

  test('allows that selected the row add up, per row', () => {
    const plan = planOf([
      rule({ id: 'a', effect: 'allow', actions: ['read'], fields: ['note'] }),
      rule({
        id: 'own',
        effect: 'allow',
        actions: ['read'],
        where: (ctx) => ({ ownerId: subjectOf(ctx) }),
        fields: ['secret'],
      }),
    ]);
    const matches = plainRowMatcher();
    expect(maskRow(plan, row, matches).$masked).toBeUndefined();
    expect(maskRow(plan, { ...row, ownerId: 'u2' }, matches).$masked).toEqual(['secret']);
  });

  test('a deny that lists a field hides it from rows it matches, and never denies the row', () => {
    const plan = planOf([
      rule({ id: 'a', effect: 'allow', actions: ['read'] }),
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['read'],
        where: () => ({ title: 'secretive' }),
        fields: ['secret'],
        reason: 'Hidden.',
      }),
    ]);
    expect(plan.kind).toBe('always');
    const matches = plainRowMatcher();
    expect(maskRow(plan, { ...row, title: 'secretive' }, matches).$masked).toEqual(['secret']);
    expect(maskRow(plan, row, matches).$masked).toBeUndefined();
  });

  test('a row without the maskable fields is returned as it is', () => {
    const plan = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'], fields: [] })]);
    const bare = { id: 'p1', title: 't' };
    expect(maskRow(plan, bare, plainRowMatcher())).toBe(bare);
  });
});

describe('checkFilterFields', () => {
  test('a masked field in a filter or sort is forbidden', () => {
    const plan = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'], fields: ['note'] })]);
    expect(() => checkFilterFields(plan, ['title', 'note'])).not.toThrow();
    expect(() => checkFilterFields(plan, ['secret'])).toThrow(
      expect.objectContaining({ kind: 'forbidden', code: 'core.forbidden' }),
    );
  });

  test('a field revealed for some rows only is forbidden too', () => {
    const plan = planOf([
      rule({
        id: 'own',
        effect: 'allow',
        actions: ['read'],
        where: (ctx) => ({ ownerId: subjectOf(ctx) }),
        fields: ['secret'],
      }),
      rule({
        id: 'a',
        effect: 'allow',
        actions: ['read'],
        where: () => ({ status: 'published' }),
        fields: ['note'],
      }),
    ]);
    expect(() => checkFilterFields(plan, ['secret'])).toThrow(/secret/);
  });

  test('a deny on another field of the rows does not change what the allows reveal', () => {
    const plan = planOf([
      rule({
        id: 'own',
        effect: 'allow',
        actions: ['read'],
        where: (ctx) => ({ ownerId: subjectOf(ctx) }),
      }),
      rule({
        id: 'trashed',
        effect: 'deny',
        actions: ['read'],
        where: () => ({ status: 'trashed' }),
        reason: 'Trashed.',
      }),
    ]);
    expect(() => checkFilterFields(plan, ['secret'])).not.toThrow();
  });

  test('a field every allow reveals passes, unless a deny lists it', () => {
    const open = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'] })]);
    expect(() => checkFilterFields(open, ['secret'])).not.toThrow();
    const hidden = planOf([
      rule({ id: 'a', effect: 'allow', actions: ['read'] }),
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['read'],
        fields: ['secret'],
        where: () => ({ title: 'x' }),
        reason: 'r',
      }),
    ]);
    expect(() => checkFilterFields(hidden, ['secret'])).toThrow(/secret/);
  });
});

describe('checkRowInPlan', () => {
  const plan = planOf([
    rule({
      id: 'own',
      effect: 'allow',
      actions: ['read'],
      where: (ctx) => ({ ownerId: subjectOf(ctx) }),
    }),
  ]);
  const outside = { id: 'p2', ownerId: 'u2' };
  const matches = plainRowMatcher();
  const ignore = (): void => undefined;

  test('a row the plan selects stays', () => {
    expect(
      checkRowInPlan({ plan, row, environment: 'production', matches, onDropped: ignore }),
    ).toBe(true);
  });

  test.each(['development', 'test'] as const)('%s fails the invocation', (environment) => {
    expect(() =>
      checkRowInPlan({ plan, row: outside, environment, matches, onDropped: ignore }),
    ).toThrow(expect.objectContaining({ kind: 'internal', code: 'core.row_outside_plan' }));
  });

  test('production drops the row and reports the action, the row id and the rule ids', () => {
    const dropped: DroppedRow[] = [];
    const kept = checkRowInPlan({
      plan,
      row: outside,
      environment: 'production',
      matches,
      onDropped: (entry) => dropped.push(entry),
    });
    expect(kept).toBe(false);
    expect(dropped).toEqual([
      {
        action: 'doc.post.query',
        entity: 'doc.post',
        rowId: 'p2',
        rules: [{ id: 'own', effect: 'allow' }],
      },
    ]);
  });

  test('a never plan selects nothing', () => {
    expect(
      checkRowInPlan({
        plan: planOf([]),
        row,
        environment: 'production',
        matches,
        onDropped: ignore,
      }),
    ).toBe(false);
  });

  test('an always plan keeps every row', () => {
    const open = planOf([rule({ id: 'a', effect: 'allow', actions: ['read'] })]);
    expect(
      checkRowInPlan({ plan: open, row: outside, environment: 'test', matches, onDropped: ignore }),
    ).toBe(true);
  });
});

describe('relation quantifiers go through the answerer, once per node', () => {
  const members = rule({
    id: 'team',
    effect: 'allow',
    actions: ['read'],
    where: (ctx) => ({ team: { members: { some: { userId: subjectOf(ctx) } } } }),
  });
  const withTeam = {
    ...post,
    relations: {
      team: { kind: 'one', target: 'doc.team', by: 'teamId', to: 'id', contributedBy: null },
    },
  } as typeof post;

  test('rows are matched from the prefetched answer', async () => {
    const plan = compilePlan({
      rules: [members],
      action: query,
      entity: withTeam,
      context: context(),
    });
    expect(plan.kind).toBe('conditional');
    const calls: { entity: string; ids: readonly string[] }[] = [];
    const matches = await createRowMatcher([plan.where], [{ id: 'a' }, { id: 'b' }], {
      entity: 'doc.post',
      answerer: async (entity, node, ids) => {
        calls.push({ entity, ids });
        expect(node.relation).toBe('team.members');
        return new Set(['a']);
      },
    });
    expect(calls).toEqual([{ entity: 'doc.post', ids: ['a', 'b'] }]);
    expect(matches(plan.where, { id: 'a' })).toBe(true);
    expect(matches(plan.where, { id: 'b' })).toBe(false);
  });

  test('a row the matcher was not built for is an error, not a silent false', async () => {
    const plan = compilePlan({
      rules: [members],
      action: query,
      entity: withTeam,
      context: context(),
    });
    const matches = await createRowMatcher([plan.where], [{ id: 'a' }], {
      entity: 'doc.post',
      answerer: async () => new Set(['a']),
    });
    expect(() => matches(plan.where, { id: 'zzz' })).toThrow(
      expect.objectContaining({ kind: 'internal', code: 'core.internal' }),
    );
  });

  test('without an answerer a quantifier is an error, not a silent false', async () => {
    const plan = compilePlan({
      rules: [members],
      action: query,
      entity: withTeam,
      context: context(),
    });
    await expect(
      createRowMatcher([plan.where], [{ id: 'a' }], { entity: 'doc.post' }),
    ).rejects.toThrow(/answerer/);
    expect(() => plainRowMatcher()(plan.where, { id: 'a' })).toThrow();
  });
});
