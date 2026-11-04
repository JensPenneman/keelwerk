/** `kw_subject_refs`: the streams that carry a subject's personal values; erasure walks it (section 14.7.4). */
export function kwSubjectRefs(root: string): readonly string[] {
  return [
    `create table "${root}".kw_subject_refs (
  scope_id uuid not null,
  subject_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  primary key (scope_id, subject_id, stream_type, stream_id)
)`,
  ];
}
