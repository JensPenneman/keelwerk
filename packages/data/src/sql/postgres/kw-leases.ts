/** `kw_leases`: leases by kind, key and holder, in the control store's root only (sections 12.2 and 15.4.9, S-120). */
export function kwLeases(root: string): readonly string[] {
  return [
    `create table "${root}".kw_leases (
  kind text not null,
  scope_id uuid,
  key text not null,
  holder text not null,
  units integer not null,
  expires_at timestamptz(3) not null,
  primary key (kind, key, holder)
)`,
    `create index kw_leases_expires on "${root}".kw_leases (expires_at)`,
  ];
}
