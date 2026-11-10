/** `kw_consumer_leases`: the one active instance of a consumer in a namespace (section 15.2.3). */
export function kwConsumerLeases(root: string): readonly string[] {
  return [
    `create table "${root}".kw_consumer_leases (
  consumer_id text primary key,
  lease_owner text not null,
  lease_expires_at timestamptz(3) not null
)`,
  ];
}
