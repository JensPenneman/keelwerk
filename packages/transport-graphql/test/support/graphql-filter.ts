function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const operatorNames = new Set([
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'nin',
  'startsWith',
  'contains',
  'isNull',
]);
const relationNames = new Set(['some', 'none', 'every', 'is']);

/** A bare filter value is `{ eq }` in GraphQL: it has no shorthand (16.4.4); `null` stays `null`, the wire's `isNull`. */
export function filterOf(filter: unknown): unknown {
  if (!isRecord(filter)) return filter;
  return Object.fromEntries(
    Object.entries(filter).map(([key, value]) => {
      if (key === 'and' || key === 'or') {
        return [key, Array.isArray(value) ? value.map(filterOf) : value];
      }
      if (key === 'not') return [key, filterOf(value)];
      if (value === null) return [key, null];
      if (isRecord(value)) {
        const keys = Object.keys(value);
        if (keys.every((name) => operatorNames.has(name))) return [key, value];
        if (keys.every((name) => relationNames.has(name))) {
          return [
            key,
            Object.fromEntries(
              Object.entries(value).map(([name, inner]) => [name, filterOf(inner)]),
            ),
          ];
        }
        return [key, filterOf(value)];
      }
      return [key, { eq: value }];
    }),
  );
}
