const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

/**
 * Whether a text is an opaque id: a UUID (8-4-4-4-12 hexadecimal characters, either case) of
 * version 4 (random) or 7 (time-ordered random), or a ULID (26 Crockford base32 characters, either
 * case, the first one from 0 to 7). The other versions are refused because each can carry a value
 * about a person or a device: versions 3 and 5 are hashes of a name, version 8 is free-form (its
 * standard's own example is a name-based hash), and versions 1 and 6 hold the MAC address of the
 * host that made them. An id that is a hash of an address or names a device is no opaque id.
 * Widening the grammar later breaks no caller; narrowing it would, so it starts narrow. The one
 * grammar of the command ids and client ids a caller chooses (7.5, 16.4.8) and of the principal ids
 * a resolver mints (`PrincipalRef.principalId`): such an id is stored in clear text in receipts,
 * jobs and the chain, where an erasure does not reach it, so it must never hold a personal value.
 * The ids the kernel itself derives (`kernel:` command ids, version 8 effect, receipt and process
 * stream ids) are never checked by this grammar.
 */
export function isOpaqueId(text: string): boolean {
  if (ulid.test(text)) return true;
  if (!uuid.test(text)) return false;
  const version = text[14];
  return version === '4' || version === '7';
}
