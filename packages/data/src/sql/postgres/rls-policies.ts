import { assertNamespaceRoot } from './assert-namespace-root.ts';

const setting = (name: string): string =>
  `nullif(current_setting('keelwerk.${name}', true), '')::uuid`;

/**
 * The scope a unit runs in (section 14.3.7, decision 111). An application root admits one scope:
 * the tenant when the unit sets one, otherwise the backend, otherwise the deployment (whose event
 * log and counters live in the application root too), so a unit never spans two scopes. The
 * control root belongs to the deployment and admits its id only.
 */
const unitScopeOf = (control: boolean): string =>
  control
    ? `scope_id = ${setting('deployment_id')}`
    : `scope_id = coalesce(${setting('tenant_id')}, ${setting('backend_id')}, ${setting('deployment_id')})`;

const inNamespaceScope = `current_setting('keelwerk.scope', true) = 'namespace'`;

/** Counter rows of a group that spans the namespace's scopes carry no scope (S-07). */
const groupScopeOf = (control: boolean): string => `scope_id is null or ${unitScopeOf(control)}`;

/** `kw_scope_keys` has one policy: a unit that sets the deployment id is a deployment unit. */
const inDeploymentScope = `nullif(current_setting('keelwerk.deployment_id', true), '') is not null`;

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

function enable(root: string, table: string): readonly string[] {
  return [
    `alter table "${root}".${table} enable row level security`,
    `alter table "${root}".${table} force row level security`,
  ];
}

function policy(root: string, table: string, name: string, predicate: string): string {
  return `create policy ${name} on "${root}".${table} using (${predicate}) with check (${predicate})`;
}

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
  const inUnitScope = unitScopeOf(control);
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
