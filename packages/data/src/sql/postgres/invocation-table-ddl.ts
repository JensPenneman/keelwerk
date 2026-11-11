import type { TableSpec } from '@keelwerk/core';
import { createTableStatements } from './create-table-statements.ts';

const scope = `coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)`;
const namespaceUnit = `current_setting('keelwerk.scope', true) = 'namespace'`;

/**
 * The statements that provision an invocation table: the table, row level security enabled and
 * forced, the `scoped` policy (a unit sees and writes the rows of its own scope) and the
 * maintenance policy of a unit of the whole namespace: every command (`all`, the receipt table),
 * or only select and delete (`select-delete`, a table whose rows only a scoped unit writes).
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
          `create policy maintenance on ${table} using (${namespaceUnit}) with check (${namespaceUnit})`,
        ]
      : [
          `create policy maintenance_select on ${table} for select using (${namespaceUnit})`,
          `create policy maintenance_delete on ${table} for delete using (${namespaceUnit})`,
        ]),
  ];
}
