import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Renews the lease of a consumer (15.2.3) when the caller owns it and it has not ended: it then
 * ends at `expiresAt`, which is `now` for a hand-over. Answers the consumer id when it renewed.
 */
export function renewConsumerLeaseStatement(
  rootName: string,
  consumer: string,
  owner: string,
  expiresAt: string,
  now: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_consumer_leases set lease_expires_at = $3::timestamptz
where consumer_id = $1::text and lease_owner = $2::text and lease_expires_at > $4::timestamptz
returning consumer_id`,
    parameters: [consumer, owner, expiresAt, now],
  };
}
