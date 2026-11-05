import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../test/authorization/fixtures.ts';
import { runtimeOperator } from '../principals/runtime-operator.ts';
import { answerMe } from './answer-me.ts';

const principal = { ...runtimeOperator, id: 'ops' };
const scope = { level: 'deployment' } as const;
const registry = {
  rules: new Map([
    [
      'doc.readMine',
      ruleEntry({
        id: 'doc.readMine',
        effect: 'allow',
        entity: 'doc.post',
        where: () => ({ members: { some: { userId: 'ops' } } }),
      }),
    ],
  ]),
};

describe('core.me and relation quantifiers (section 8.7)', () => {
  test('a quantifier is written as the ids the relation reaches', async () => {
    const asked: string[] = [];
    const me = await answerMe(principal, scope, registry, async (entity, node) => {
      asked.push(`${entity}:${node.relation}`);
      return ['p1', 'p2'];
    });
    expect(asked).toEqual(['doc.post:members']);
    expect(me.rules).toEqual([
      expect.objectContaining({ subject: 'doc.post', conditions: { id: { $in: ['p1', 'p2'] } } }),
    ]);
  });

  test('a set the reach leaves open, or no reach at all, is serverOnly', async () => {
    const open = await answerMe(principal, scope, registry, async () => undefined);
    expect(open.rules).toEqual([expect.objectContaining({ serverOnly: true })]);
    const none = await answerMe(principal, scope, registry);
    expect(none.rules).toEqual([expect.objectContaining({ serverOnly: true })]);
  });
});
