import { rlsParts } from './rls-parts.ts';

/** The maintenance policies of a table whose rows only a scoped unit writes: a namespace unit reads and deletes them, never inserts or updates. */
export const selectDeletePolicies = (table: string): readonly string[] => [
  `create policy maintenance_select on ${table} for select using (${rlsParts.inNamespaceScope})`,
  `create policy maintenance_delete on ${table} for delete using (${rlsParts.inNamespaceScope})`,
];
