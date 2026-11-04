/** The entity name a part is mounted on: the name itself, or the key under which the base lists the entity value. */
export function mountName(source: object, target: unknown): string {
  if (typeof target === 'string') return target;
  const base = (source as { readonly base?: object }).base ?? source;
  const entities =
    (base as { readonly entities?: { readonly [name: string]: unknown } }).entities ?? {};
  return Object.keys(entities).find((name) => entities[name] === target) ?? '';
}
