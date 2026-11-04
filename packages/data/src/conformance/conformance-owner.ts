import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/** The target of references and the source of the `probes` quantifiers; `parentId` is a hard reference to a row of its own table. */
export const conformanceOwner: EntityDescriptor = conformanceEntity(
  'conf.owner',
  'tenant',
  {
    name: conformanceField('string', 'name'),
    rank: conformanceField('integer', 'rank'),
    parentId: conformanceField('ref', 'parent_id', {
      ref: { entity: 'conf.owner', foreignKey: true },
    }),
  },
  {
    probes: {
      kind: 'many',
      target: 'conf.probe',
      by: 'ownerId',
      to: 'id',
      contributedBy: null,
    },
  },
);
