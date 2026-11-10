/** `kw_schedules`: the last and the next tick of a schedule per scope (S-118). */
export function kwSchedules(root: string): readonly string[] {
  return [
    `create table "${root}".kw_schedules (
  scope_id uuid not null,
  schedule_id text not null,
  last_tick timestamptz(3),
  next_tick timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  primary key (scope_id, schedule_id)
)`,
    `create index kw_schedules_due on "${root}".kw_schedules (next_tick)`,
  ];
}
