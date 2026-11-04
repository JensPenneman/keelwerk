/** `kw_job_lane_counts`: the `enqueued` and `done` counters of a lane, carrying the lane's scope (section 9.5.2). */
export function kwJobLaneCounts(root: string): readonly string[] {
  return [
    `create table "${root}".kw_job_lane_counts (
  lane_id bigint not null,
  kind text not null check (kind in ('enqueued', 'done')),
  scope_id uuid not null,
  value bigint not null default 0,
  primary key (lane_id, kind),
  foreign key (lane_id, scope_id) references "${root}".kw_job_lanes (id, scope_id)
)`,
  ];
}
