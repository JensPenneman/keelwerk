/**
 * The plain JSON form of resolver arguments: GraphQL builds argument objects without a prototype,
 * and the wire decoder reads plain JSON. The copy goes through JSON, so a key such as `__proto__`
 * stays an own key and nothing but JSON values pass.
 */
export function plainOf(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
