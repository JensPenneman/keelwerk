import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.commandReceipt` entity (S-26). */
export const commandReceipt: CoreBase['entities']['commandReceipt'] = defineEntity({
  prefix: 'rcpt',
  fields: {
    commandId: field.string(),
    status: field.enum(['accepted', 'succeeded', 'failed']),
  },
  history: 'state',
  tenancy: 'invocation',
  generated: { set: false },
});
