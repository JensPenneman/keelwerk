import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Takes the lease of a consumer in a namespace (15.2.3): the row is inserted, or taken over when
 * the owner is the caller or the lease ended at or before `now`. The statement answers the
 * consumer id when the caller holds the lease afterwards and nothing otherwise; a second taker
 * waits for the first one's row lock and then finds the lease held.
 */
export function acquireConsumerLeaseStatement(
  rootName: string,
  consumer: string,
  owner: string,
  expiresAt: string,
  now: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_consumer_leases as l (consumer_id, lease_owner, lease_expires_at)
values ($1::text, $2::text, $3::timestamptz)
on conflict (consumer_id) do update set
  lease_owner = excluded.lease_owner,
  lease_expires_at = excluded.lease_expires_at
where l.lease_owner = $2::text or l.lease_expires_at <= $4::timestamptz
returning consumer_id`,
    parameters: [consumer, owner, expiresAt, now],
  };
}
