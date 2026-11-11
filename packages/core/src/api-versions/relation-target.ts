/**
 * The entity a relation path of a filter ends on: `key` is one relation name or a dotted path of
 * them (section 16.4.4), each step resolved with `targetOf`. Undefined when a step is not a
 * relation, which makes `key` a field name.
 */
export function relationTarget(
  entity: string,
  key: string,
  targetOf: (entity: string, relation: string) => string | undefined,
): string | undefined {
  let at: string | undefined = entity;
  for (const step of key.split('.')) {
    at = targetOf(at, step);
    if (at === undefined) return undefined;
  }
  return at;
}
