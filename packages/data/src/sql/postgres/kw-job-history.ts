/** `kw_job_history`: the outcome of a finished job, never its input (section 9.5.2, S-07). */
export function kwJobHistory(root: string): readonly string[] {
  return [
    `create table "${root}".kw_job_history (
  scope_id uuid,
  job_id bigint,
  queue text,
  kind text,
  outcome text check (outcome in ('succeeded', 'failed', 'dead', 'cancelled')),
  attempts integer,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  error jsonb,
  primary key (scope_id, job_id)
)`,
  ];
}
