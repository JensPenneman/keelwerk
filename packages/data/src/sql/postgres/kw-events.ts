/** `kw_events`, its type index and the indexes of `EventStore.find` (section 15.1.2). */
export function kwEvents(root: string): readonly string[] {
  return [
    `create table "${root}".kw_events (
  scope_id uuid not null,
  position bigint not null,
  backend_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  stream_version integer not null,
  partition_key text,
  event_id uuid not null,
  name text not null,
  schema_version integer not null,
  shape_id bytea not null,
  data jsonb not null,
  before jsonb,
  meta jsonb not null,
  hlc text not null,
  recorded_at timestamptz(3) not null,
  transient boolean not null default false,
  prev_hash bytea,
  hash bytea,
  primary key (scope_id, position),
  unique (scope_id, stream_type, stream_id, stream_version)
)`,
    `create index kw_events_type on "${root}".kw_events (scope_id, stream_type, partition_key, position)`,
    `create index kw_events_command on "${root}".kw_events (scope_id, (meta->>'commandId'))`,
    `create index kw_events_causation on "${root}".kw_events (scope_id, (meta->>'causationId'))`,
  ];
}
