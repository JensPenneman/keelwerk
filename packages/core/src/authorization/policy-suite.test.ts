import { describe, expect, test } from 'vitest';
import { context, entityAction, rule } from '../../test/authorization/fixtures.ts';
import { post, subjectOf } from '../../test/authorization/post-fixture.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { checkItem } from './check-item.ts';
import { compilePlan } from './compile-plan.ts';
import type { NormalizedRule } from './normalized-rule.ts';

const earlier = Temporal.Instant.from('2026-01-01T00:00:00Z');
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

describe('the three consequences of section 8.2', () => {
  const revoke = [
    rule({
      id: 'doc.post.self-revoke',
      effect: 'allow',
      actions: ['revoke'],
      principal: 'user',
      where: (ctx) => ({ ownerId: subjectOf(ctx) }),
    }),
    rule({
      id: 'doc.post.already-revoked',
      effect: 'deny',
      actions: ['revoke'],
      where: () => ({ revokedAt: { isNull: false } }),
      reason: 'This credential is already revoked.',
    }),
  ];

  test.each([
    {
      name: 'revoking an active credential is allowed',
      pre: owned({ revokedAt: null }),
      post: owned({ revokedAt: earlier }),
      allowed: true,
    },
    {
      name: 'revoking a revoked credential is denied with the reason',
      pre: owned({ revokedAt: earlier }),
      post: owned({ revokedAt: earlier }),
      allowed: false,
      reason: 'This credential is already revoked.',
    },
    {
      name: "revoking someone else's credential is not selected",
      pre: { id: 'p1', ownerId: 'u2', revokedAt: null },
      post: { id: 'p1', ownerId: 'u2', revokedAt: earlier },
      allowed: false,
    },
  ])('a deny without check tests the pre-image: $name', ({ pre, post: after, allowed, reason }) => {
    const both = verdict(revoke, 'revoke', { pre, post: after });
    expect(both.allowed).toBe(allowed);
    expect(both.reason).toBe(reason);
    expect(verdict(revoke, 'revoke', { pre }).allowed).toBe(allowed);
  });

  test('the revocation itself is never what the deny rule matches', () => {
    const result = verdict(revoke, 'revoke', {
      pre: owned({ revokedAt: null }),
      post: owned({ revokedAt: earlier }),
    });
    expect(result.rules).toEqual([{ id: 'doc.post.self-revoke', effect: 'allow' }]);
  });

  const editor = [
    rule({
      id: 'doc.post.editor',
      effect: 'allow',
      actions: ['update'],
      where: (ctx) => ({ ownerId: subjectOf(ctx) }),
      check: () => ({ status: { in: ['draft', 'published'] } }),
    }),
  ];

  test.each([
    { name: 'publish a draft', pre: 'draft', post: 'published', allowed: true },
    { name: 'unpublish', pre: 'published', post: 'draft', allowed: true },
    { name: 'move it anywhere else', pre: 'draft', post: 'trashed', allowed: false },
  ])('a check bounds the row produced: $name', ({ pre, post: after, allowed }) => {
    const result = verdict(
      editor,
      'update',
      { pre: owned({ status: pre }), post: owned({ status: after }) },
      { generated: 'update' },
    );
    expect(result.allowed).toBe(allowed);
    expect(result.rules).toEqual([{ id: 'doc.post.editor', effect: 'allow' }]);
  });

  const profile = [
    rule({
      id: 'doc.post.frozen',
      effect: 'deny',
      actions: ['deactivate', 'update'],
      where: () => ({ deactivatedAt: { isNull: false } }),
      reason: 'The profile is deactivated.',
    }),
    rule({
      id: 'doc.post.own',
      effect: 'allow',
      actions: ['deactivate', 'update'],
      where: (ctx) => ({ ownerId: subjectOf(ctx) }),
    }),
  ];

  test.each([
    {
      name: 'an active profile can be deactivated',
      action: 'deactivate',
      pre: owned({ deactivatedAt: null }),
      post: owned({ deactivatedAt: earlier }),
      allowed: true,
    },
    {
      name: 'a deactivated profile cannot be updated',
      action: 'update',
      pre: owned({ deactivatedAt: earlier }),
      post: owned({ deactivatedAt: earlier, title: 'x' }),
      allowed: false,
    },
    {
      name: 'a deactivated profile cannot be deactivated again',
      action: 'deactivate',
      pre: owned({ deactivatedAt: earlier }),
      post: owned({ deactivatedAt: earlier }),
      allowed: false,
    },
    {
      name: 'an active profile can be updated',
      action: 'update',
      pre: owned({ deactivatedAt: null }),
      post: owned({ deactivatedAt: null, title: 'x' }),
      allowed: true,
    },
  ])('a freeze: $name', ({ action, pre, post: after, allowed }) => {
    expect(verdict(profile, action, { pre, post: after }).allowed).toBe(allowed);
  });
});
