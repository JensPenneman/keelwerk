import { note } from './note.ts';

export const kindOf = (field: string) => note.fields[field]?.kind;
