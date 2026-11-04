import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/** A serial per `boxId` (15.1.4). */
export const conformanceTicket: EntityDescriptor = conformanceEntity('conf.ticket', 'tenant', {
  boxId: conformanceField('string', 'box_id', { optional: false }),
  seq: conformanceField('serial', 'seq', { constraints: { per: 'boxId' } }),
});
