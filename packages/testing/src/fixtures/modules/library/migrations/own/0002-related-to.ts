import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = {
  id: '0002-related-to',
  steps: [
    {
      column: {
        constraints: {},
        default: null,
        field: 'relatedTo',
        kind: 'ref',
        name: 'related_to',
        nullable: true,
      },
      entity: 'library.book',
      field: 'relatedTo',
      op: 'addColumn',
    },
    {
      entity: 'library.book',
      key: {
        columns: ['tenant_id', 'related_to'],
        name: 'library__book__related_to_fk',
        references: {
          columns: ['tenant_id', 'id'],
          table: 'library__book',
        },
      },
      op: 'addForeignKey',
    },
  ],
  track: 'library',
};
