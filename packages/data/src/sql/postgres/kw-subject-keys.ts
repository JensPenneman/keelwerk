/**
 * `kw_subject_keys`: wrapped per-subject keys; shredded rows keep their metadata and lose the key
 * material (section 14.7.4). `purpose` separates data keys from per-subject index keys.
 */
export function kwSubjectKeys(root: string): readonly string[] {
  return [
    `create table "${root}".kw_subject_keys (
  scope_id uuid not null,
  subject_id uuid not null,
  key_id text not null,
  purpose text not null default 'data' check (purpose in ('data', 'index')),
  wrapped bytea,
  kek_version integer not null,
  created_at timestamptz(3) not null,
  shredded_at timestamptz(3),
  primary key (scope_id, key_id)
)`,
    `create index kw_subject_keys_subject on "${root}".kw_subject_keys (scope_id, subject_id, purpose, created_at)`,
  ];
}
