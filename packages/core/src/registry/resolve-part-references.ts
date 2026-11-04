/**
 * The reference a part value resolves to: a string as is, or the reference `defineModule` stamped
 * on a mounted part (`auth.credential.revoke`); undefined for a part no module literal mounts.
 */
export function resolvePartReference(part: unknown): string | undefined {
  if (typeof part === 'string') return part;
  if (typeof part !== 'object' && typeof part !== 'function') return undefined;
  if (part === null) return undefined;
  const ref: unknown = Reflect.get(part, 'ref');
  return typeof ref === 'string' ? ref : undefined;
}
