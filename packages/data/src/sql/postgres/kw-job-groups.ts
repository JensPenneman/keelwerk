/** `kw_job_groups`: concurrency and rate counters; `scope_id` is null when the group spans the namespace (S-07). */
export function kwJobGroups(root: string): readonly string[] {
  return [
    `create table "${root}".kw_job_groups (
  id text primary key,
  scope_id uuid,
  concurrency integer,
  running integer not null default 0,
  rate text,
  tokens double precision,
  refilled_at timestamptz(3),
  blocked_until timestamptz
)`,
  ];
}
