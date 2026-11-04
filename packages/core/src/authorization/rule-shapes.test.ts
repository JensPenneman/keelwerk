import { describe, expect, test } from 'vitest';
import { context, entityAction, rule } from '../../test/authorization/fixtures.ts';
import { post, subjectOf } from '../../test/authorization/post-fixture.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { checkItem } from './check-item.ts';
import { compilePlan } from './compile-plan.ts';
import type { NormalizedRule } from './normalized-rule.ts';

const owned = (extra: StorageRow = {}): StorageRow => ({ id: 'p1', ownerId: 'u1', ...extra });

function verdict(
  rules: readonly NormalizedRule[],
  actionName: string,
  images: { pre?: StorageRow; post?: StorageRow },
  options: { generated?: 'update' | 'create' | 'archive' | 'restore' } = {},
): ReturnType<typeof checkItem> {
  const action = entityAction(
    actionName,
    options.generated === undefined ? {} : { generated: options.generated },
  );
  const plan = compilePlan({ rules, action, entity: post, context: context() });
  return checkItem(plan, images);
}

describe('every rule shape against the pre-image, the post-image and both', () => {
  const own = (ctx: Parameters<typeof subjectOf>[0]): { ownerId: string | undefined } => ({
    ownerId: subjectOf(ctx),
  });
  const pre = owned({ status: 'draft' });
  const good = owned({ status: 'published' });
  const bad = owned({ status: 'trashed' });
  const stranger = { id: 'p1', ownerId: 'u2', status: 'draft' };

  const shapes: readonly {
    readonly shape: string;
    readonly rules: readonly NormalizedRule[];
    readonly cases: readonly (readonly [
      string,
      { pre?: StorageRow; post?: StorageRow },
      boolean,
    ])[];
  }[] = [
    {
      shape: 'allow where',
      rules: [rule({ id: 'a', effect: 'allow', actions: ['update'], where: own })],
      cases: [
        ['pre selects', { pre }, true],
        ['pre of a stranger', { pre: stranger }, false],
        ['both', { pre, post: good }, true],
      ],
    },
    {
      shape: 'allow where + check',
      rules: [
        rule({
          id: 'a',
          effect: 'allow',
          actions: ['update'],
          where: own,
          check: () => ({ status: { in: ['draft', 'published'] } }),
        }),
      ],
      cases: [
        ['pre selects', { pre }, true],
        ['both pass', { pre, post: good }, true],
        ['pre selects and post fails', { pre, post: bad }, false],
        ['pre of a stranger and post passes', { pre: stranger, post: good }, false],
      ],
    },
    {
      shape: 'allow without where',
      rules: [rule({ id: 'a', effect: 'allow', actions: ['update'] })],
      cases: [
        ['pre', { pre }, true],
        ['both', { pre, post: bad }, true],
      ],
    },
    {
      shape: 'allow + deny without check',
      rules: [
        rule({ id: 'a', effect: 'allow', actions: ['update'], where: own }),
        rule({
          id: 'd',
          effect: 'deny',
          actions: ['update'],
          where: () => ({ status: 'trashed' }),
          reason: 'r',
        }),
      ],
      cases: [
        ['the deny tests the pre-image', { pre }, true],
        ['pre trashed', { pre: owned({ status: 'trashed' }) }, false],
        ['trashed only in the post-image', { pre, post: bad }, true],
      ],
    },
    {
      shape: 'allow + deny with check',
      rules: [
        rule({ id: 'a', effect: 'allow', actions: ['update'], where: own }),
        rule({
          id: 'd',
          effect: 'deny',
          actions: ['update'],
          where: () => ({ status: 'draft' }),
          check: () => ({ status: 'trashed' }),
          reason: 'A draft cannot be trashed.',
        }),
      ],
      cases: [
        ['pre alone does not trip the check', { pre }, true],
        ['draft to trashed trips both', { pre, post: bad }, false],
        [
          'published to trashed trips only the check',
          { pre: owned({ status: 'published' }), post: bad },
          true,
        ],
        ['draft to published trips only the where', { pre, post: good }, true],
      ],
    },
    {
      shape: 'two allows, one with a check',
      rules: [
        rule({
          id: 'a1',
          effect: 'allow',
          actions: ['update'],
          where: own,
          check: () => ({ status: 'published' }),
        }),
        rule({
          id: 'a2',
          effect: 'allow',
          actions: ['update'],
          where: () => ({ status: 'draft' }),
        }),
      ],
      cases: [
        ['an allow without check selected the target', { pre, post: bad }, true],
        [
          'the owner of a published row needs the check',
          { pre: owned({ status: 'published' }), post: bad },
          false,
        ],
        [
          'the owner of a published row passes it',
          { pre: owned({ status: 'published' }), post: good },
          true,
        ],
      ],
    },
  ];

  for (const { shape, rules, cases } of shapes) {
    test.each(cases)(`${shape}: %s`, (_name, images, allowed) => {
      expect(verdict(rules, 'update', images, { generated: 'update' }).allowed).toBe(allowed);
    });
  }

  test.each([
    ['allow where', true, { ownerId: 'u1' }],
    ['allow where, other owner', false, { ownerId: 'u2' }],
  ])('create tests the new row with where: %s', (_name, allowed, row) => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['create'], where: own })];
    expect(
      verdict(rules, 'create', { post: { id: 'n', ...row } }, { generated: 'create' }).allowed,
    ).toBe(allowed);
  });

  test('create prefers check over where on both allow and deny rules', () => {
    const rules = [
      rule({
        id: 'a',
        effect: 'allow',
        actions: ['create'],
        where: () => false,
        check: () => ({ status: 'draft' }),
      }),
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['create'],
        where: () => ({ status: 'draft' }),
        check: () => ({ title: 'spam' }),
        reason: 'No spam.',
      }),
    ];
    const create = (row: StorageRow) =>
      verdict(rules, 'create', { post: row }, { generated: 'create' });
    expect(create({ id: 'n', status: 'draft', title: 'hello' }).allowed).toBe(true);
    const spam = create({ id: 'n', status: 'draft', title: 'spam' });
    expect(spam.allowed).toBe(false);
    expect(spam.reason).toBe('No spam.');
    expect(create({ id: 'n', status: 'published' }).allowed).toBe(false);
  });

  test('a create without its post-image is an internal error', () => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['create'] })];
    expect(() => verdict(rules, 'create', {}, { generated: 'create' })).toThrow(/post-image/);
  });
});

describe('transitions need their pre-image', () => {
  const own = (ctx: Parameters<typeof subjectOf>[0]): { ownerId: string | undefined } => ({
    ownerId: subjectOf(ctx),
  });
  const pre = owned({ status: 'draft' });
  const good = owned({ status: 'published' });
  const bad = owned({ status: 'trashed' });

  test('a transition needs the pre-image: the post-image alone is an internal error', () => {
    const rules = [rule({ id: 'a', effect: 'allow', actions: ['update'], where: own })];
    expect(() => verdict(rules, 'update', { post: good }, { generated: 'update' })).toThrow(
      /pre-image/,
    );
    expect(() => verdict(rules, 'update', {}, { generated: 'update' })).toThrow(/pre-image/);
  });

  test('an allow that did not select the target lends no check to a transition', () => {
    const rules = [
      rule({
        id: 'a1',
        effect: 'allow',
        actions: ['update'],
        where: own,
        check: () => ({ status: 'published' }),
      }),
      rule({
        id: 'a2',
        effect: 'allow',
        actions: ['update'],
        where: () => ({ status: 'archived' }),
        check: () => ({ status: 'trashed' }),
      }),
    ];
    expect(verdict(rules, 'update', { pre, post: bad }, { generated: 'update' }).allowed).toBe(
      false,
    );
  });

  test('a field deny tests the pre-image, so unlocking and retitling in one write is refused', () => {
    const rules = [
      rule({ id: 'a', effect: 'allow', actions: ['update'], where: own }),
      rule({
        id: 'd',
        effect: 'deny',
        actions: ['update'],
        where: () => ({ status: 'locked' }),
        fields: ['title'],
        reason: 'Locked.',
      }),
    ];
    const locked = owned({ status: 'locked', title: 'a' });
    const unlockedAndRetitled = owned({ status: 'draft', title: 'b' });
    const action = entityAction('update', { generated: 'update' });
    const plan = compilePlan({ rules, action, entity: post, context: context() });
    const verdictOf = checkItem(plan, {
      pre: locked,
      post: unlockedAndRetitled,
      changed: ['status', 'title'],
    });
    expect(verdictOf.allowed).toBe(false);
    expect(verdictOf.forbiddenFields).toEqual(['title']);
  });
});
