import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { rlsParts } from './rls-parts.ts';
import { transientPurgeBatchSql } from './transient-purge-batch-sql.ts';

/**
 * The statements of framework step 0004 (14.7.1, 15.1.11). On `kw_events`: a partial index over
 * the transient change records of receipts, which the purge walks by scope and recording time, and
 * `kw_purge_transient(before, max_rows, stream_types)`, the one way the application role removes
 * event records. The function is owned by the role that migrates, runs as it (`security definer`,
 * `search_path` pinned, every object schema-qualified) and `execute` is revoked from `public`; the
 * grant to the application role is in `transientPurgeRoleDdl`. The role has no `delete` on the
 * table and no policy admits it one.
 * The function enforces its own conditions, because an owner that bypasses row-level security is
 * not bound by the policies and because any session that holds the application role can call it:
 * the one stream type it may delete, `core.commandReceipt`, is written into the step as a literal
 * (a list that names any other type is refused with 42501, an empty list deletes nothing); it
 * raises in a namespace-scope unit and in a unit that names no scope, when `max_rows` is outside 1
 * to 100000 and, with errcode 22023, when `before` or `stream_types` is null. It deletes only
 * records of the unit's scope that are transient, carry no hash and no previous hash, were
 * recorded before `before` and are not the newest of their stream, at most `max_rows`, oldest
 * first. The one exception to the newest record: that of a receipt stream whose receipt row is
 * gone from the scope (the row id is the stream id), because the stream serves no one then; a root
 * without a receipt table keeps every newest record. It does not compare `before` with the
 * database clock: the adapter's clock is the time authority. It answers `removed`, how many it
 * deleted, and `more`, whether a candidate is left: read by a statement of its own after the
 * delete, never derived from `removed`, because a delete that skipped rows another pass took
 * removes fewer than `max_rows` while older candidates remain.
 * With `control` (the control root) the scope is the deployment's, else the tenant's, the
 * backend's or the deployment's, the same expression as the policies of `rlsPoliciesDdl`. The
 * control root also gets the columns that make a retention run a complete record of its pass.
 * Stored format: final once released, changed only by a later framework step.
 */
export function transientPurgeDdl(
  root: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const control = options.control === true;
  const events = `"${schema}".kw_events`;
  const fn = `"${schema}".kw_purge_transient`;
  const withReceipts = transientPurgeBatchSql(schema, true);
  const withoutReceipts = transientPurgeBatchSql(schema, false);
  return [
    `create index kw_events_transient on ${events} (scope_id, recorded_at, position) where transient and stream_type = 'core.commandReceipt'`,
    ...(control
      ? [
          `alter table "${schema}".kw_retention_runs add column namespace_id text, add column outcome text, add column error jsonb`,
        ]
      : []),
    `create function ${fn}(before timestamptz, max_rows integer, stream_types text[]) returns table (removed integer, more boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $kw_purge$
declare
  cutoff timestamptz := before;
  unit_scope uuid := ${rlsParts.unitScopeValue(control)};
  has_receipts boolean := pg_catalog.to_regclass('"${schema}".core__command_receipt') is not null;
begin
  if current_setting('keelwerk.scope', true) is not distinct from 'namespace' then
    raise exception 'kw_purge_transient: a namespace-scope unit purges nothing' using errcode = '42501';
  end if;
  if unit_scope is null then
    raise exception 'kw_purge_transient: the unit names no scope' using errcode = '42501';
  end if;
  if max_rows is null or max_rows < 1 or max_rows > 100000 then
    raise exception 'kw_purge_transient: max_rows is a whole number from 1 to 100000' using errcode = '22023';
  end if;
  if cutoff is null then
    raise exception 'kw_purge_transient: before is an instant' using errcode = '22023';
  end if;
  if stream_types is null then
    raise exception 'kw_purge_transient: stream_types is a list of stream types' using errcode = '22023';
  end if;
  if not (stream_types <@ array['core.commandReceipt']::text[]) then
    raise exception 'kw_purge_transient: only the stream type core.commandReceipt may be purged' using errcode = '42501';
  end if;
  if cardinality(stream_types) = 0 then
    removed := 0;
    more := false;
    return next;
    return;
  end if;
  if has_receipts then
    ${withReceipts.batch};
    get diagnostics removed = row_count;
    -- A statement of its own: under read committed it sees what other units committed since the
    -- delete began, so a batch that skipped rows another pass took does not pass for an empty
    -- buffer. Rows another pass is still deleting stay visible, which errs towards "more".
    ${withReceipts.more} into more;
  else
    ${withoutReceipts.batch};
    get diagnostics removed = row_count;
    ${withoutReceipts.more} into more;
  end if;
  return next;
end
$kw_purge$`,
    `revoke execute on function ${fn}(timestamptz, integer, text[]) from public`,
  ];
}
