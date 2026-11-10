import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { rlsParts } from './rls-parts.ts';

const { unitScope, inNamespaceScope, inDeploymentScope, enable, policy } = rlsParts;

/** Counter rows of a group that spans the namespace's scopes carry no scope (S-07). */
const groupScopeOf = (control: boolean): string => `scope_id is null or ${unitScope(control)}`;

/** Tables the fair take and the completions reach from namespace-scope units (section 9.5.3). */
const queueTables: readonly string[] = [
  'kw_job_lanes',
  'kw_job_lane_counts',
  'kw_job_groups',
  'kw_jobs',
  'kw_job_history',
];

/** Scoped tables that only migrations and maintenance reach from a namespace-scope unit. */
const maintainedTables: readonly string[] = [
  'kw_positions',
  'kw_events',
  'kw_serials',
  'kw_usage',
  'kw_rate_buckets',
  'kw_subject_keys',
  'kw_value_keys',
  'kw_index_keys',
  'kw_subject_refs',
];

/**
 * Forced row-level security of every scoped framework table of a namespace: the `scoped` policy
 * matches `scope_id` against the setting of the unit's scope, each wrapped in `nullif` because a
 * pooled connection keeps a finished unit's setting as `''` (decision 111); queue tables add a
 * `take` policy and the other tables a `maintenance` policy for `keelwerk.scope = 'namespace'`
 * units. With `control` (the control store's root), rows belong to the deployment and
 * `kw_scope_keys` is admitted to units that set `keelwerk.deployment_id`.
 */
export function rlsPoliciesDdl(
  root: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const control = options.control === true;
  const inUnitScope = unitScope(control);
  const statements: string[] = [];
  for (const table of queueTables) {
    statements.push(...enable(schema, table));
    statements.push(
      policy(
        schema,
        table,
        'scoped',
        table === 'kw_job_groups' ? groupScopeOf(control) : inUnitScope,
      ),
    );
    statements.push(policy(schema, table, 'take', inNamespaceScope));
  }
  for (const table of maintainedTables) {
    statements.push(...enable(schema, table));
    statements.push(policy(schema, table, 'scoped', inUnitScope));
    statements.push(policy(schema, table, 'maintenance', inNamespaceScope));
  }
  if (control) {
    statements.push(...enable(schema, 'kw_scope_keys'));
    statements.push(policy(schema, 'kw_scope_keys', 'deployment', inDeploymentScope));
  }
  return statements;
}
