/** `kw_migrations`: the applied migration files per track; the checksum is lower-case hexadecimal SHA-256 (section 14.6.3). */
export function kwMigrations(root: string): readonly string[] {
  return [
    `create table "${root}".kw_migrations (
  track text not null,
  id text not null,
  checksum text not null,
  applied_at timestamptz(3) not null,
  duration_ms integer not null,
  steps_applied integer not null,
  primary key (track, id)
)`,
  ];
}
