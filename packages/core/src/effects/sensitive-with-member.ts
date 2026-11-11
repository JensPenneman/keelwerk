import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { effectDataSubject } from './effect-data-subject.ts';

/**
 * The first member of an effect's `with` that its continuation declares personal or secret (7.9.6,
 * S-127), or undefined. The record keeps `with` in plaintext next to the sealed input, and the
 * event that carries it is hashed into the chain, so such a member could never be erased.
 */
export function sensitiveWithMember(
  continuation: ActionEntry,
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  const schemas: StandardSchemaV1[] = [continuation.input];
  if (continuation.outcomeWith !== undefined) schemas.push(continuation.outcomeWith);
  for (const schema of schemas) {
    const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
    if (fields === undefined) continue;
    for (const name of Object.keys(value)) {
      const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
      if (field === undefined) continue;
      if (holdsCredential(field) || effectDataSubject({}, field) !== undefined) return name;
    }
  }
  return undefined;
}
