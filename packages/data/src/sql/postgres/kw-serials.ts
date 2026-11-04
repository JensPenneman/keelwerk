/**
 * `kw_serials`: the next value of a serial field per partition (section 15.1.4). `partition` holds
 * the canonical JSON of the `per` values.
 */
export function kwSerials(root: string): readonly string[] {
  return [
    `create table "${root}".kw_serials (
  scope_id uuid not null,
  entity text not null,
  field text not null,
  partition text not null,
  next bigint not null,
  primary key (scope_id, entity, field, partition)
)`,
  ];
}
