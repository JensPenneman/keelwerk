import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = {
  id: '0001-initial',
  steps: [
    {
      column: {
        constraints: {},
        default: null,
        field: 'bookId',
        kind: 'ref',
        name: 'book_id',
        nullable: true,
      },
      entity: 'loans.loan',
      field: 'bookId',
      op: 'addColumn',
    },
    {
      entity: 'loans.loan',
      key: {
        columns: ['tenant_id', 'book_id'],
        name: 'loans__loan__book_id_fk',
        references: {
          columns: ['tenant_id', 'id'],
          table: 'library__book',
        },
      },
      op: 'addForeignKey',
    },
  ],
  track: 'loans[library]',
};
