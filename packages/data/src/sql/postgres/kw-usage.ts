/** `kw_usage`: quota counters per scope and dimension, committed with the data they count (section 12.2). */
export function kwUsage(root: string): readonly string[] {
  return [
    `create table "${root}".kw_usage (
  scope_id uuid not null,
  dimension text not null,
  value bigint not null default 0,
  primary key (scope_id, dimension)
)`,
  ];
}
