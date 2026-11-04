import { notes } from './notes.ts';

export const live = notes.filter((row) => row.archivedAt === undefined);
