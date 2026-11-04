import { describe, expect, test } from 'vitest';
import {
  context,
  entityAction,
  entityDescriptor,
  fieldDescriptor,
  rule,
} from '../../test/authorization/fixtures.ts';
import { checkItem } from './check-item.ts';
import { compilePlan } from './compile-plan.ts';

const odd = entityDescriptor('doc.odd', {
  op: fieldDescriptor('string'),
  field: fieldDescriptor('string'),
  value: fieldDescriptor('string'),
});

describe('rule conditions over fields named like the AST', () => {
  test('an entity with fields op, field and value takes the object form', () => {
    const rules = [
      rule({
        id: 'a',
        entity: 'doc.odd',
        effect: 'allow',
        actions: ['update'],
        where: () => ({ op: 'eq', field: 'f', value: 'v' }),
      }),
    ];
    const action = entityAction('update', { entity: 'doc.odd', generated: 'update' });
    const plan = compilePlan({ rules, action, entity: odd, context: context() });
    expect(checkItem(plan, { pre: { id: '1', op: 'eq', field: 'f', value: 'v' } })).toMatchObject({
      allowed: true,
    });
    expect(checkItem(plan, { pre: { id: '1', op: 'eq', field: 'x', value: 'v' } })).toMatchObject({
      allowed: false,
    });
  });
});
