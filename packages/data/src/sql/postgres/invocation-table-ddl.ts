import type { TableSpec } from '@keelwerk/core';
import { createTableStatements } from './create-table-statements.ts';
import { rlsParts } from './rls-parts.ts';
import { selectDeletePolicies } from './select-delete-policies.ts';

const scope = `coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)`;

/**
 * The statements that provision an invocation table: the table, row level security enabled and
 * forced, the `scoped` policy (a unit sees and writes the rows of its own scope) and the
 * maintenance policy of a unit of the whole namespace: every command (`all`, a table that a
 * planner step copies or backfills), or only select and delete (`select-delete`, the receipt and
 * effect tables, whose rows only a scoped unit writes).
 */
export function invocationTableDdl(
  root: string,
  spec: TableSpec,
  maintenance: 'all' | 'select-delete' = 'all',
): readonly string[] {
  const table = `"${root}".${spec.name}`;
  return [
    ...createTableStatements(root, spec),
    `alter table ${table} enable row level security`,
    `alter table ${table} force row level security`,
    `create policy scoped on ${table} using (scope_id = ${scope}) with check (scope_id = ${scope})`,
    ...(maintenance === 'all'
      ? [
          `create policy maintenance on ${table} using (${rlsParts.inNamespaceScope}) with check (${rlsParts.inNamespaceScope})`,
        ]
      : selectDeletePolicies(table)),
  ];
}
