const plainName = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$/;

/**
 * Whether an entity or field name is camelCase without consecutive capitals (section 14.4.2):
 * physical names snake-case them, so `fooBar` and `fooBAR` would map to the same column.
 */
export function isPlainName(name: string): boolean {
  return plainName.test(name);
}
