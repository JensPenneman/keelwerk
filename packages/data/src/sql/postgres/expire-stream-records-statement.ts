import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Removes the records of one stream that are older than `before` or beyond the newest `maxPerKey`
 * of their key, oldest first by `(at, key, seq)`, at most `limit`, and returns one row per record
 * removed. No branch ranks the whole stream: the age branch reads `(scope_id, stream, at)` in
 * order and stops after `limit` rows; the per-key branch walks the distinct keys through the
 * primary key, finds each key's newest-`maxPerKey` edge by one index probe, and takes at most
 * `limit` older records of that key. So a batch costs about the rows it removes plus one probe per
 * key, however long the stream is.
 */
export function expireStreamRecordsStatement(
  rootName: string,
  input: {
    readonly scopeId: string;
    readonly stream: string;
    readonly before: string | null;
    readonly maxPerKey: number | null;
    readonly limit: number;
  },
): PostgresStatement {
  const table = `${quoteIdentifier(rootName)}.kw_stream_records`;
  const parameters: unknown[] = [input.scopeId, input.stream, input.limit];
  const limit = '$3';
  const inStream = (alias: string) => `${alias}.scope_id = $1 and ${alias}.stream = $2`;
  const branches: string[] = [];
  const ctes: string[] = [];
  if (input.before !== null) {
    parameters.push(input.before);
    branches.push(`(select a.key, a.seq, a.at from ${table} as a
  where ${inStream('a')} and a.at < $${parameters.length}::timestamptz
  order by a.at, a.key, a.seq limit ${limit})`);
  }
  if (input.maxPerKey !== null) {
    parameters.push(input.maxPerKey);
    ctes.push(`keys(key) as (
  (select k.key from ${table} as k where ${inStream('k')} order by k.key limit 1)
  union all
  select (select n.key from ${table} as n where ${inStream('n')} and n.key > keys.key order by n.key limit 1)
  from keys where keys.key is not null
)`);
    branches.push(`(select old.key, old.seq, old.at from keys
  cross join lateral (
    select e.seq from ${table} as e
    where ${inStream('e')} and e.key = keys.key
    order by e.seq desc offset ($${parameters.length}::bigint - 1) limit 1
  ) as edge
  cross join lateral (
    select o.key, o.seq, o.at from ${table} as o
    where ${inStream('o')} and o.key = keys.key and o.seq < edge.seq
    order by o.seq limit ${limit}
  ) as old
  where keys.key is not null)`);
  }
  ctes.push(`doomed as (
  select c.key, c.seq from (
${branches.join('\n  union\n')}
  ) as c
  order by c.at, c.key, c.seq
  limit ${limit}
)`);
  return {
    sql: `with${input.maxPerKey === null ? '' : ' recursive'} ${ctes.join(', ')}
delete from ${table} as records using doomed
where records.scope_id = $1 and records.stream = $2
  and records.key = doomed.key and records.seq = doomed.seq
returning 1`,
    parameters,
  };
}
