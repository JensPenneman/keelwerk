/**
 * `kw_job_groups`: concurrency and rate counters keyed by (`scope_id`, `id`), the id being the bare declared key;
 * `scope_id` is null when the group spans the namespace (S-07), and nulls are not distinct so such a group is one row.
 */
export function kwJobGroups(root: string): readonly string[] {
  return [
    `create table "${root}".kw_job_groups (
  id text not null,
  scope_id uuid,
  concurrency integer,
  running integer not null default 0,
  rate text,
  tokens double precision,
  refilled_at timestamptz(3),
  blocked_until timestamptz,
  unique nulls not distinct (scope_id, id)
)`,
  ];
}
