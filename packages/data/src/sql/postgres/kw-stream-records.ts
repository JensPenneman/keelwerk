/** `kw_stream_records`: the records of a declared stream per scope, stream and key; `seq` is drawn from `kw_serials` (section 15.1.12). */
export function kwStreamRecords(root: string): readonly string[] {
  return [
    `create table "${root}".kw_stream_records (
  scope_id uuid not null,
  stream text not null,
  key text not null,
  seq bigint not null,
  at timestamptz(3) not null,
  data jsonb not null,
  primary key (scope_id, stream, key, seq)
)`,
    `create index kw_stream_records_at on "${root}".kw_stream_records (scope_id, stream, at)`,
  ];
}
