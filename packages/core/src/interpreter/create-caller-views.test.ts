import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../test/authorization/fixtures.ts';
import { actionOf, registryOf, user } from '../../test/invoker/invoker-kit.ts';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import { createCallerViews } from './create-caller-views.ts';

const query = actionOf('doc.post.search', { kind: 'query', entity: 'doc.post' });
const command = actionOf('doc.post.close', { kind: 'command', entity: 'doc.post', instance: true });
const registry = registryOf([query, command]);
const readers = normalizeRule(
  ruleEntry({ id: 'doc.post.readers', effect: 'allow', actions: ['read'], where: () => ({}) }),
);
const closers = normalizeRule(
  ruleEntry({ id: 'doc.post.closers', effect: 'allow', actions: ['close'], where: () => ({}) }),
);
const entry = (() => {
  const found = registry.entities.get('doc.post');
  if (found === undefined) throw new Error('the fixture has no doc.post');
  return found;
})();
const context = {
  registry,
  principal: user('ada'),
  scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
} as unknown as AnswerContext;

describe('createCallerViews', () => {
  test('a command on its own entity plans forCaller as the read plan, never its own rules', () => {
    const view = createCallerViews([closers], command)(entry, context);
    expect(view.plan.kind).toBe('never');
    expect(view.plan.action).toBe('doc.post.query');
    expect(createCallerViews([readers, closers], command)(entry, context).plan.kind).toBe('always');
  });

  test('a query on its own entity is planned as invoked', () => {
    expect(createCallerViews([readers], query)(entry, context).plan.action).toBe('doc.post.search');
  });
});
