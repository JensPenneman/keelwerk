/** `kw_scope_keys`: wrapped deployment, backend and tenant keys, in the control store's root only (section 14.7.4, S-55). */
export function kwScopeKeys(root: string): readonly string[] {
  return [
    `create table "${root}".kw_scope_keys (
  scope_id uuid,
  level text not null check (level in ('deployment', 'backend', 'tenant')),
  version integer,
  wrapped bytea not null,
  created_at timestamptz(3) not null,
  retired_at timestamptz(3),
  primary key (scope_id, version)
)`,
  ];
}
