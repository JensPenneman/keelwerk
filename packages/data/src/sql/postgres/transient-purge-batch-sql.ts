/**
 * The two statements of `kw_purge_transient` (framework step 0004), as text over the function's
 * variables `unit_scope`, `cutoff` and `max_rows`: `batch` deletes one batch and `more` asks
 * whether a candidate is left. The stream type is written out as a literal, never read from the
 * argument or from a list of the kernel: the function is a stored protection of the history of
 * state entities, so widening it is a later framework step that replaces the function. A candidate
 * is a transient record of that type, without a hash or a previous hash, older than `cutoff`, that
 * is not its stream's newest record. With `receipts` the newest record of a stream is a candidate
 * too once no receipt row of the scope has the stream's id (the stream serves no one then, and its
 * version starts again at 1 if the command id returns); without it (the root has no receipt table)
 * the newest record of every stream stays. The text is a stored format: never edited after the
 * step is released.
 */
export function transientPurgeBatchSql(
  schema: string,
  receipts: boolean,
): { readonly batch: string; readonly more: string } {
  const events = `"${schema}".kw_events`;
  const receiptTable = `"${schema}".core__command_receipt`;
  // The `offset 0` in each subquery is deliberate (a fence the planner does not look through):
  // without it the planner turns the test into a join, reads the whole scope (and hashes every
  // receipt of the root) and sorts the candidates, where one probe of an index per row, in the
  // order of the partial index, stops at `max_rows`.
  const newer = `exists (select 1 from ${events} as n
        where n.scope_id = ALIAS.scope_id and n.stream_type = ALIAS.stream_type
          and n.stream_id = ALIAS.stream_id and n.stream_version > ALIAS.stream_version offset 0)`;
  const kept = receipts
    ? `${newer}
      or not exists (select 1 from ${receiptTable} as r
        where r.scope_id = ALIAS.scope_id and r.id = ALIAS.stream_id offset 0)`
    : newer;
  /** What the function deletes, for the batch and for the question whether any is left. */
  const candidate = (alias: string): string =>
    `${alias}.scope_id = unit_scope and ${alias}.transient and ${alias}.stream_type = 'core.commandReceipt'
      and ${alias}.hash is null and ${alias}.prev_hash is null and ${alias}.recorded_at < cutoff
      and (${kept.replaceAll('ALIAS', alias)})`;
  return {
    batch: `with doomed as (
    select e.position from ${events} as e
    where ${candidate('e')}
    order by e.recorded_at, e.position
    limit max_rows
  )
  delete from ${events} as events
  where events.scope_id = unit_scope
    and events.position = any(array(select d.position from doomed as d))
    and events.transient and events.stream_type = 'core.commandReceipt'
    and events.hash is null and events.prev_hash is null`,
    more: `select exists (select 1 from ${events} as c where ${candidate('c')})`,
  };
}
