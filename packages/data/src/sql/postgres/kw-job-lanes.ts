/** `kw_job_lanes`: one row per scope, queue, capability set and priority class (section 9.5.2). */
export function kwJobLanes(root: string): readonly string[] {
  return [
    `create table "${root}".kw_job_lanes (
  id bigint generated always as identity primary key,
  scope_id uuid not null,
  queue text not null,
  capability_set text not null,
  priority smallint not null,
  cap integer not null,
  weight integer not null,
  taken bigint not null default 0,
  vtime double precision not null default 0,
  unique (queue, capability_set, scope_id, priority),
  unique (id, scope_id)
)`,
  ];
}
