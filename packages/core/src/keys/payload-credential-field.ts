import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { type CredentialHolder, holdsCredential } from './holds-credential.ts';

/** The first field of an event payload shape that holds a credential at all: event payloads are not sealed (14.7.4), so such a shape is refused. */
export function payloadCredentialField(
  schema: StandardSchemaV1 | null | undefined,
): string | undefined {
  const fields = (
    schema as { readonly fields?: Readonly<Record<string, CredentialHolder>> } | null | undefined
  )?.fields;
  if (fields === undefined) return undefined;
  for (const [name, field] of Object.entries(fields)) {
    if (holdsCredential(field)) return name;
  }
  return undefined;
}
