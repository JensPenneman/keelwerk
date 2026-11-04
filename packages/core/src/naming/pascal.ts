/** `api-keys.key.revoke` becomes `ApiKeysKeyRevoke`; `.`, `-` and `_` separate the words (section 16.4.1). */
export function pascal(ref: string): string {
  return ref
    .split(/[.\-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
