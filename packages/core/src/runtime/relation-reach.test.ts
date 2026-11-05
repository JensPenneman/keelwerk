import { describe, expect, test } from 'vitest';
import type { RelationNode } from '../authorization/condition-to-mongo.ts';
import type { InvokerOptions } from '../invoker/invoker-options.ts';
import { reachCap } from './reach-cap.ts';
import { relationReach } from './relation-reach.ts';

const node: RelationNode = {
  op: 'some',
  relation: 'members',
  where: { op: 'eq', field: 'userId', value: 'ada' },
};
const registry = { entities: new Map([['doc.post', { descriptor: { ref: 'doc.post' } }]]) };

function optionsOf(
  count: number,
  fail = false,
): Pick<InvokerOptions, 'directory' | 'placement' | 'control'> {
  const rows = Array.from({ length: count }, (_, index) => ({ id: `p${index}` }));
  const adapter = {
    unit: async (_namespace: unknown, _scope: unknown, run: (unit: unknown) => Promise<unknown>) =>
      run({
        rows: {
          find: async () => {
            if (fail) throw new Error('unreadable');
            return { rows };
          },
        },
      }),
  };
  return {
    control: { scope: { level: 'deployment' }, namespace: {}, handle: { adapter } },
  } as never;
}

const scope = { level: 'deployment' } as const;

describe('the reach of a relation quantifier', () => {
  test('answers the ids of the rows it admits', async () => {
    const reach = relationReach(optionsOf(2), scope, registry as never);
    expect(await reach('doc.post', node)).toEqual(['p0', 'p1']);
  });

  test('answers undefined above the cap, for an unknown entity and for an unreadable set', async () => {
    expect(
      await relationReach(optionsOf(reachCap), scope, registry as never)('doc.post', node),
    ).toHaveLength(reachCap);
    expect(
      await relationReach(optionsOf(reachCap + 1), scope, registry as never)('doc.post', node),
    ).toBeUndefined();
    expect(
      await relationReach(optionsOf(1), scope, registry as never)('doc.other', node),
    ).toBeUndefined();
    expect(
      await relationReach(optionsOf(1, true), scope, registry as never)('doc.post', node),
    ).toBeUndefined();
  });
});
