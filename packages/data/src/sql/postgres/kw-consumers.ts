/** `kw_consumers`: the checkpoint of a consumer per scope, its position in the scope's event log (section 15.2.3). */
export function kwConsumers(root: string): readonly string[] {
  return [
    `create table "${root}".kw_consumers (
  consumer_id text not null,
  scope_id uuid not null,
  position bigint not null,
  updated_at timestamptz(3) not null,
  primary key (consumer_id, scope_id)
)`,
  ];
}
