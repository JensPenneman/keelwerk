import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

function withSearch(entity: EntityDescriptor): EntityDescriptor {
  return {
    ...entity,
    searchIndexes: [
      { name: 'text', fields: ['handle'], form: 'native', keys: null, languages: [] },
    ],
  };
}

/** A unique field, a unique index with a partial predicate, and a unique pair. */
export const conformanceAccount: EntityDescriptor = withSearch(
  conformanceEntity(
    'conf.account',
    'tenant',
    {
      handle: conformanceField('string', 'handle', { unique: true }),
      slot: conformanceField('integer', 'slot'),
      kind: conformanceField('enum', 'kind', { constraints: { values: ['primary', 'other'] } }),
      region: conformanceField('string', 'region'),
      code: conformanceField('string', 'code'),
    },
    {},
    [
      {
        name: 'conf__account_primary_slot',
        fields: ['slot'],
        unique: true,
        where: { op: 'eq', field: 'kind', value: 'primary' },
      },
      { name: 'conf__account_region_code', fields: ['region', 'code'], unique: true, where: null },
    ],
  ),
);
