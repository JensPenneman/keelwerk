/** `kw_jobs` and the index the fair take reads (sections 9.5.2 and 9.5.3, S-07). */
export function kwJobs(root: string): readonly string[] {
  return [
    `create table "${root}".kw_jobs (
  id bigint generated always as identity primary key,
  scope_id uuid not null,
  lane_id bigint not null,
  queue text not null,
  kind text not null check (kind in ('action', 'effect')),
  state text not null check (state in ('scheduled', 'available', 'waiting', 'running', 'dead')),
  run_at timestamptz not null default now(),
  principal jsonb not null,
  causation jsonb not null,
  build_id text not null,
  revision integer not null,
  api_version text,
  ordering text not null default 'none' check (ordering in ('none', 'fifo-per-key')),
  group_id text,
  group_spec jsonb,
  key text,
  cost integer not null default 1,
  retry jsonb,
  heartbeat_seconds integer not null default 10,
  expire_in_seconds integer,
  dead_letter text,
  input jsonb not null,
  worker text,
  attempt integer not null default 0,
  lease_until timestamptz,
  created_at timestamptz(3) not null,
  foreign key (lane_id, scope_id) references "${root}".kw_job_lanes (id, scope_id)
)`,
    `create index kw_jobs_take on "${root}".kw_jobs (lane_id, run_at, id) where state = 'available'`,
  ];
}
