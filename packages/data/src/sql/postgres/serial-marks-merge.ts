/**
 * The SQL that merges two `serials` objects of `kw_scope_marks` (member name to a decimal string)
 * into one that holds the greater value of each member: a mark only ever rises (S-119).
 */
export function serialMarksMerge(stored: string, given: string): string {
  return `coalesce((select jsonb_object_agg(g.k, g.v) from (select u.k, max(u.v::numeric)::text as v from (select e.key as k, e.value as v from jsonb_each_text(${stored}) e union all select e.key, e.value from jsonb_each_text(${given}) e) u group by u.k) g), '{}'::jsonb)`;
}
