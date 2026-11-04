/** A column default or comparison value as a SQL literal (string, finite number, boolean or null). */
export function sqlLiteral(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return `'${value.replaceAll("'", "''")}'`;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('a non-finite number is no literal');
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      throw new TypeError(`a ${typeof value} is no SQL literal`);
  }
}
