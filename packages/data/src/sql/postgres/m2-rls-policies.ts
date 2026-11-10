import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { rlsParts } from './rls-parts.ts';

/** Scoped tables whose rows namespace units reach through the `maintenance` set (D6). */
const maintainedTables: readonly string[] = [
  'kw_consumers',
  'kw_parked',
  'kw_stream_records',
  'kw_schedules',
];

/** The tables of the control store only: deployment units reach them and no other unit does. */
const controlTables: readonly string[] = [
  'kw_namespace_identities',
  'kw_scope_marks',
  'kw_leases',
  'kw_queue_pauses',
  'kw_ledger',
  'kw_api_usage',
  'kw_retention_runs',
];

/**
 * Forced row-level security of the tables of framework step 0002. The consumer, parked, stream
 * record and schedule tables get a `scoped` policy on `scope_id` and a `maintenance` policy for
 * `keelwerk.scope = 'namespace'` units; `kw_consumer_leases` has no scope and one `take` policy for
 * those units. With `control`, the seven control tables have one `deployment` policy: their rows
 * name tenant scopes, so only units that set `keelwerk.deployment_id` reach them.
 */
export function m2RlsPoliciesDdl(
  root: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const control = options.control === true;
  const statements: string[] = [];
  for (const table of maintainedTables) {
    statements.push(...rlsParts.enable(schema, table));
    statements.push(rlsParts.policy(schema, table, 'scoped', rlsParts.unitScope(control)));
    statements.push(rlsParts.policy(schema, table, 'maintenance', rlsParts.inNamespaceScope));
  }
  statements.push(...rlsParts.enable(schema, 'kw_consumer_leases'));
  statements.push(rlsParts.policy(schema, 'kw_consumer_leases', 'take', rlsParts.inNamespaceScope));
  if (control) {
    for (const table of controlTables) {
      statements.push(...rlsParts.enable(schema, table));
      statements.push(rlsParts.policy(schema, table, 'deployment', rlsParts.inDeploymentScope));
    }
  }
  return statements;
}
