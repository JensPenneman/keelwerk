const pattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A PostgreSQL identifier, double-quoted; a name outside the plain grammar throws. */
export function quoteIdentifier(name: string): string {
  if (!pattern.test(name))
    throw new TypeError(`${JSON.stringify(name)} is not a usable identifier`);
  return `"${name}"`;
}
