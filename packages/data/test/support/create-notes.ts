import type { MigrationFile } from '@keelwerk/core';
import { noteTable } from './note-table.ts';

export const createNotes: MigrationFile = {
  id: '0001-notes',
  track: 'app',
  steps: [{ op: 'createTable', entity: 'app.note', table: noteTable }],
};
