/** `kw_index_keys`: the tenant's wrapped index root keys per version (section 14.7.9.7). */
export function kwIndexKeys(root: string): readonly string[] {
  return [
    `create table "${root}".kw_index_keys (
  scope_id uuid not null,
  version integer not null,
  wrapped bytea not null,
  created_at timestamptz(3) not null,
  retired_at timestamptz(3),
  primary key (scope_id, version)
)`,
  ];
}
