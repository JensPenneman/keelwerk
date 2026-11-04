import { describe, expect, test } from 'vitest';
import type { Condition } from './condition.ts';
import { conditionFields } from './condition-fields.ts';
import { evaluateCondition } from './evaluate-condition.ts';
import type { RelationMatcher } from './evaluate-options.ts';
import { normalizeCondition } from './normalize-condition.ts';

describe('conditionFields', () => {
  test('lists fields, relations and quantifier nodes in order of first appearance', () => {
    const condition = normalizeCondition({
      ownerId: 'u1',
      or: [{ team: { members: { some: { userId: 'u1' } } } }, { status: 'open' }],
      not: { owner: { is: { id: 'u1' } } },
    });
    const found = conditionFields(condition);
    expect(found.fields).toEqual(['ownerId', 'status']);
    expect(found.relations).toEqual(['team.members', 'owner']);
    expect(found.quantifiers.map((node) => node.op)).toEqual(['some', 'is']);
  });

  test('does not descend into a where', () => {
    const condition = normalizeCondition({
      team: { members: { some: { boss: { is: { id: 'x' } } } } },
    });
    expect(conditionFields(condition).quantifiers).toHaveLength(1);
  });
});

describe('pre-fetching quantifiers', () => {
  type Quantifier = Extract<Condition, { readonly relation: string }>;
  const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];

  test('one batched lookup per node answers the matcher from a map keyed by the node', async () => {
    const condition = normalizeCondition({
      or: [
        { members: { some: { userId: 's1' } } },
        { members: { none: { userId: 's2' } }, ownerId: 's1' },
      ],
    });
    const matchingRows = async (node: Quantifier): Promise<ReadonlySet<string>> => {
      await Promise.resolve();
      return node.op === 'some' ? new Set(['r1']) : new Set(['r2', 'r3']);
    };
    const answers = new Map<Quantifier, ReadonlySet<string>>();
    for (const node of conditionFields(condition).quantifiers) {
      answers.set(node, await matchingRows(node));
    }
    expect(answers.size).toBe(2);
    const matching: RelationMatcher = (node, row) =>
      answers.get(node)?.has(String(row.id)) ?? false;
    const owned = rows.map((row) => ({ ...row, ownerId: row.id === 'r2' ? 's1' : 'z' }));
    expect(owned.map((row) => evaluateCondition(condition, row, { matching }))).toEqual([
      true,
      true,
      false,
    ]);
  });
});
