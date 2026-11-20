import { principalValueKeyPrefix } from './principal-value-key-prefix.ts';

/**
 * The id of the value key a principal's request records are sealed under: one long-lived key per
 * principal id (the id its receipts carry), so an erasure that matches the id finds the key with
 * no search. The prefix keeps it apart from the random ids of the other value keys. The key lives
 * in the store of value keys, never in the one of subject data keys, so no subject listing,
 * inventory or doctor output can show a principal id as a subject.
 */
export function principalValueKeyId(principalId: string): string {
  return `${principalValueKeyPrefix}${principalId}`;
}
