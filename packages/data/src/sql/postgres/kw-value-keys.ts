/** `kw_value_keys`: one wrapped key per sealed credential value, deleted when the value is replaced (section 14.7.4). */
export function kwValueKeys(root: string): readonly string[] {
  return [
    `create table "${root}".kw_value_keys (
  scope_id uuid not null,
  key_id text not null,
  wrapped bytea not null,
  kek_version integer not null,
  created_at timestamptz(3) not null,
  primary key (scope_id, key_id)
)`,
  ];
}
