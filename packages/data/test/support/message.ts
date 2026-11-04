import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** A tenant entity with a serial field partitioned by mailbox. */
export const message: EntityDescriptor = entityOf('app.message', 'app__message', 'tenant', {
  uid: fieldOf('serial', 'uid', { constraints: { per: 'mailboxId' } }),
});
