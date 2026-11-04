import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** A tenant entity with a unique field, a partial unique index and a personal unique field. */
export const account: EntityDescriptor = {
  ...entityOf(
    'app.account',
    'app__account',
    'tenant',
    {
      handle: fieldOf('string', 'handle', { unique: true }),
      slot: fieldOf('integer', 'slot'),
      kind: fieldOf('enum', 'kind'),
      email: fieldOf('string', 'email', {
        unique: true,
        personal: {
          subject: 'id',
          queries: ['eq'],
          normalize: { id: 'exact', version: 1 },
          params: {
            eq: { bits: 128 },
            prefix: { min: 3, max: 30 },
            contains: { bits: 64 },
            order: { bytes: 8 },
          },
          keys: 'tenant',
        },
      }),
    },
    {},
    {
      emailEq: { field: 'email', kind: 'binary', query: 'eq', column: 'email__eq', keyVersion: 1 },
    },
  ),
  indexes: [
    {
      name: 'app__account_slot',
      fields: ['slot'],
      unique: true,
      where: { op: 'eq', field: 'kind', value: 'primary' },
    },
  ],
  searchIndexes: [{ name: 'text', fields: ['handle'], form: 'native', keys: null, languages: [] }],
};
