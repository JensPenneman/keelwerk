import { type CredentialHolder, holdsCredential } from './holds-credential.ts';

/**
 * The name of the first field of `fields` that holds a credential in a place the kernel does not
 * seal: a list or set of secrets or verifiers (`field.list(field.secret())`). Only a top-level
 * `field.secret()` or `field.verifier()` of an entity is sealed per value (14.7.4); anything else
 * would be stored in plaintext, so it is refused instead.
 */
export function nestedCredentialField(
  fields: Readonly<Record<string, CredentialHolder>>,
): string | undefined {
  for (const [name, field] of Object.entries(fields)) {
    if (field.kind !== 'secret' && field.kind !== 'verifier' && holdsCredential(field)) return name;
  }
  return undefined;
}
