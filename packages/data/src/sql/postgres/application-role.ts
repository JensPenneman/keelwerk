import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { assertRoleName } from './assert-role-name.ts';

/** Tables the application role may change; the others it reads only. */
const writableTables: readonly string[] = [
  'kw_positions',
  'kw_job_lanes',
  'kw_job_lane_counts',
  'kw_job_groups',
  'kw_jobs',
  'kw_job_history',
  'kw_serials',
  'kw_usage',
  'kw_rate_buckets',
  'kw_subject_keys',
  'kw_value_keys',
  'kw_index_keys',
  'kw_subject_refs',
];

/** Append-only tables (section 1, principle 8): the role reads and inserts, never updates or deletes. */
const appendOnlyTables: readonly string[] = ['kw_shapes', 'kw_events'];

/**
 * Grants the application role what it needs in a namespace: schema usage, data changes on the
 * framework tables (insert only on the append-only event log and shapes), and read access to the migration history, which only migrations (run as the
 * owner) write. Identity columns need no sequence grant.
 */
export function applicationRoleDdl(
  root: string,
  role: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const name = assertRoleName(role);
  const tables = options.control === true ? [...writableTables, 'kw_scope_keys'] : writableTables;
  return [
    `grant usage on schema "${schema}" to "${name}"`,
    ...appendOnlyTables.map((table) => `grant select, insert on "${schema}".${table} to "${name}"`),
    ...tables.map(
      (table) => `grant select, insert, update, delete on "${schema}".${table} to "${name}"`,
    ),
    `grant select on "${schema}".kw_migrations to "${name}"`,
  ];
}
