import type { PrincipalRef, StandardSchemaV1 } from '@keelwerk/core';

/** The most a stored reference may be as JSON text, in characters. */
const maxReferenceLength = 2048;
/** The deepest a member of a stored reference may nest. */
const maxDepth = 6;

function isJsonValue(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= maxDepth) return false;
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((member) => isJsonValue(member, depth + 1));
}

/**
 * The stored form of a `PrincipalRef`: an object of the resolver id and the principal id, both text,
 * and every other member the resolving module adds to its reference (section 8.5), so the column holds
 * what a job of the same principal stores and `fromRef` reads the same members at redeem and at every
 * revalidation. The members must be JSON values and the whole reference stays under a small bound.
 */
export const principalRefSchema: StandardSchemaV1<PrincipalRef, PrincipalRef> = {
  '~standard': {
    version: 1,
    vendor: 'keelwerk',
    validate: (value: unknown) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { issues: [{ message: 'Expected an object.' }] };
      }
      const { resolver, principalId } = value as Record<string, unknown>;
      if (typeof resolver !== 'string' || typeof principalId !== 'string') {
        return { issues: [{ message: 'Expected a resolver and a principal id.' }] };
      }
      if (!isJsonValue(value, 0)) {
        return { issues: [{ message: 'Every member of a principal reference is a JSON value.' }] };
      }
      if (JSON.stringify(value).length > maxReferenceLength) {
        return { issues: [{ message: 'A principal reference is too large.' }] };
      }
      return { value: { ...(value as PrincipalRef) } };
    },
  },
};
