/**
 * `kw_scope_marks`: the position, serials and epoch of each scope in each namespace, in the control
 * store's root only (section 14.7.6, S-119). Each member of `serials` is named
 * `canonicalizeJson([entity, field, partition])`, the key of a `kw_serials` counter, and holds its
 * high-water value as a decimal string (a bigint does not fit a JSON number). The counters of
 * `stream:` entities (D8) and `core.effectAttempt` are not marked: stream seqs are read only under
 * epoch-bound tokens, so the epoch bump alone covers a rewind, and a member per effect would grow the
 * value that is rewritten every minute without bound.
 */
export function kwScopeMarks(root: string): readonly string[] {
  return [
    `create table "${root}".kw_scope_marks (
  scope_id uuid not null,
  namespace_id text not null,
  position bigint not null,
  serials jsonb not null,
  epoch integer not null,
  updated_at timestamptz(3) not null,
  primary key (scope_id, namespace_id)
)`,
    `create index kw_scope_marks_namespace on "${root}".kw_scope_marks (namespace_id)`,
  ];
}
