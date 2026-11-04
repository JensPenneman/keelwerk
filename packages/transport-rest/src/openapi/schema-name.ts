import { pascal } from '@keelwerk/core';

const suffixes = {
  read: '',
  create: 'Create',
  patch: 'Patch',
  filter: 'Filter',
  input: 'Input',
  output: 'Output',
  problem: 'Problem',
} as const;

/** Which schema of a reference a name is for. */
export type SchemaRole = keyof typeof suffixes;

/** The component schema name of a reference: `accounts.profile` read is `AccountsProfile`, an error `accounts.email_taken` is `AccountsEmailTakenProblem` (sections 16.4.1 and 16.5.5). */
export function schemaName(role: SchemaRole, ref: string): string {
  return `${pascal(ref)}${suffixes[role]}`;
}
