import type { TableSpec } from '@keelwerk/core';
import { quoteIdentifier } from './quote-identifier.ts';

const setting = (name: string): string =>
  `nullif(current_setting('keelwerk.${name}', true), '')::uuid`;

/**
 * Forced row-level security of an entity table (section 14.3.7, decision 111): the `scoped` policy
 * admits the rows of the unit's tenant or backend, a deployment entity admits any unit that names
 * its deployment, and `maintenance` admits the kernel's namespace-scope units (migrations,
 * rebuilds).
 */
export function tablePolicyDdl(
  root: string,
  table: string,
  scoped: TableSpec['scoped'],
): readonly string[] {
  const target = `${quoteIdentifier(root)}.${quoteIdentifier(table)}`;
  const predicate =
    scoped === 'tenant'
      ? `tenant_id = ${setting('tenant_id')}`
      : scoped === 'backend'
        ? `backend_id = ${setting('backend_id')}`
        : `${setting('deployment_id')} is not null`;
  const maintenance = `current_setting('keelwerk.scope', true) = 'namespace'`;
  return [
    `alter table ${target} enable row level security`,
    `alter table ${target} force row level security`,
    `create policy scoped on ${target} using (${predicate}) with check (${predicate})`,
    `create policy maintenance on ${target} using (${maintenance}) with check (${maintenance})`,
  ];
}
