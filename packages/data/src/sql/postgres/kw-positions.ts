/** `kw_positions`: one counter row per scope (section 15.1.2). */
export function kwPositions(root: string): readonly string[] {
  return [
    `create table "${root}".kw_positions (
  scope_id uuid primary key,
  next bigint not null,
  epoch integer not null
)`,
  ];
}
