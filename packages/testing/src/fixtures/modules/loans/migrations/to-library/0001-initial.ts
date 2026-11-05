import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = {
  id: '0001-initial',
  steps: [
    {
      column: {
        constraints: {},
        default: null,
        field: 'reservedBy',
        kind: 'subject',
        name: 'reserved_by',
        nullable: true,
      },
      entity: 'library.book',
      field: 'reservedBy',
      op: 'addColumn',
    },
  ],
  track: 'loans->library',
};
