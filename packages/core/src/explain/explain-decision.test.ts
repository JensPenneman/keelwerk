import { describe, expect, test } from 'vitest';
import { context, entityAction, ruleEntry } from '../../test/authorization/fixtures.ts';
import { post } from '../../test/authorization/post-fixture.ts';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { explainDecision } from './explain-decision.ts';

const get = entityAction('get', { generated: 'get' }) as unknown as ActionEntry;
const update = {
  ...entityAction('update', { generated: 'update' }),
  entityOutput: { entity: 'doc.post', shape: 'row' },
} as unknown as ActionEntry;
const registry = {
  actions: new Map([
    [get.ref, get],
    [update.ref, update],
  ]),
  entities: new Map([['doc.post', { ref: 'doc.post', descriptor: post } as EntityEntry]]),
};
const rules = [
  ruleEntry({ id: 'doc.post.reveal', effect: 'allow', actions: ['read'], fields: ['title'] }),
  ruleEntry({ id: 'doc.post.edit', effect: 'allow', actions: ['update'], fields: ['secret'] }),
].map(normalizeRule);

describe('explainDecision', () => {
  test('a command that returns an entity shows the masks of the read plan shaping its output', () => {
    const explained = explainDecision({ registry, rules, action: update, context: context() });
    expect(explained.plan?.operation).toBe('transition');
    // The command's own rule lists "secret"; the read plan reveals only "title", so both are hidden.
    expect(explained.plan?.masks).toEqual([
      { field: 'secret', revealedBy: [], hiddenBy: [] },
      { field: 'note', revealedBy: [], hiddenBy: [] },
    ]);
  });

  test('a query shows the masks of its own plan', () => {
    const explained = explainDecision({ registry, rules, action: get, context: context() });
    expect(explained.plan?.masks).toEqual([
      { field: 'secret', revealedBy: [], hiddenBy: [] },
      { field: 'note', revealedBy: [], hiddenBy: [] },
    ]);
  });
});
