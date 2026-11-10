/** `kw_retention_runs`: one append per finished retention run, in the control store's root only (section 14.7.1, S-172). */
export function kwRetentionRuns(root: string): readonly string[] {
  return [
    `create table "${root}".kw_retention_runs (
  run_id uuid primary key,
  started_at timestamptz(3) not null,
  ended_at timestamptz(3) not null,
  backend_id uuid not null,
  tenant_id uuid,
  rule jsonb not null,
  removed jsonb not null,
  horizons jsonb not null
)`,
    `create index kw_retention_runs_scope on "${root}".kw_retention_runs (backend_id, tenant_id, started_at)`,
  ];
}
