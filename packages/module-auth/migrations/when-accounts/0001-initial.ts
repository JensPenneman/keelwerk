import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = {
  id: '0001-initial',
  steps: [
    {
      column: {
        constraints: {},
        default: null,
        field: 'profileId',
        kind: 'ref',
        name: 'profile_id',
        nullable: true,
      },
      entity: 'auth.credential',
      field: 'profileId',
      op: 'addColumn',
    },
    {
      entity: 'auth.credential',
      index: {
        columns: ['tenant_id', 'profile_id'],
        method: 'btree',
        name: 'auth__credential__profile_id_ix',
        unique: false,
        where: null,
      },
      op: 'createIndex',
    },
    {
      entity: 'auth.credential',
      key: {
        columns: ['tenant_id', 'profile_id'],
        name: 'auth__credential__profile_id_fk',
        references: {
          columns: ['tenant_id', 'id'],
          table: 'accounts__profile',
        },
      },
      op: 'addForeignKey',
    },
  ],
  track: 'auth[accounts]',
};
