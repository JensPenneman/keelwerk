import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { assertRoleName } from './assert-role-name.ts';

const writableTables: readonly string[] = [
  'kw_consumers',
  'kw_consumer_leases',
  'kw_parked',
  'kw_stream_records',
  'kw_schedules',
];

/** The control tables the role may append to and read, never update or delete (principle 8). */
const appendOnlyControlTables: readonly string[] = ['kw_ledger', 'kw_retention_runs'];

const writableControlTables: readonly string[] = [
  'kw_namespace_identities',
  'kw_scope_marks',
  'kw_leases',
  'kw_queue_pauses',
  'kw_api_usage',
];

/**
 * Grants the application role what it needs in the tables of framework step 0002: data changes on
 * the five namespace tables; with `control`, select and insert on the ledger and the retention runs
 * (append only, section 1 principle 8) and data changes on the other control tables. Schema usage
 * comes with step 0001.
 */
export function m2ApplicationRoleDdl(
  root: string,
  role: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const name = assertRoleName(role);
  const control = options.control === true;
  return [
    ...writableTables.map(
      (table) => `grant select, insert, update, delete on "${schema}".${table} to "${name}"`,
    ),
    ...(control
      ? [
          ...appendOnlyControlTables.map(
            (table) => `grant select, insert on "${schema}".${table} to "${name}"`,
          ),
          ...writableControlTables.map(
            (table) => `grant select, insert, update, delete on "${schema}".${table} to "${name}"`,
          ),
        ]
      : []),
  ];
}
