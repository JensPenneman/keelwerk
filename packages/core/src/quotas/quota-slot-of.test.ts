import { expect, test } from 'vitest';
import { quotaSlotOf } from './quota-slot-of.ts';

test('the slot of a tenant row has three parts', () => {
  expect(quotaSlotOf('core.rows', 'b1', 't1')).toBe('core.rows@b1@t1');
  expect(quotaSlotOf('queue:commands.running', 'b1', 't1')).toBe('queue:commands.running@b1@t1');
});
