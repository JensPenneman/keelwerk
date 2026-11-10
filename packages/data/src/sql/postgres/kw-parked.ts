/**
 * `kw_parked`: a stream a consumer parked after its attempts ran out, and the position it stopped at
 * (section 15.2.3). `attempts` is written by the store alone: 1 when the row is inserted, and one
 * more each time the same stream is parked again while its row exists, so it counts the parkings, not
 * the failed deliveries; `ConsumerStore.park(consumer, stream, from, error)` carries no attempt count
 * and the store does not know the consumer's `maxAttempts` (specification gap: section 15.2.3 lists
 * an attempt count that section 14.3.2's `park` does not supply).
 */
export function kwParked(root: string): readonly string[] {
  return [
    `create table "${root}".kw_parked (
  consumer_id text not null,
  scope_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  from_position bigint not null,
  attempts integer not null,
  last_error jsonb not null,
  parked_at timestamptz(3) not null,
  primary key (consumer_id, scope_id, stream_type, stream_id)
)`,
  ];
}
