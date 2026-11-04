const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const lineWidth = 100;

function quote(text: string): string {
  const plain = [...text].every((char) => char !== "'" && char !== '\\' && char >= ' ');
  return plain ? `'${text}'` : JSON.stringify(text);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * A JSON value as TypeScript source in the repository's style: single quotes, two-space
 * indentation, trailing commas, unquoted keys, objects always expanded, and arrays of primitives
 * on one line while they fit in 100 columns. `undefined` members are left out.
 */
export function renderLiteral(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent + 1);
  const close = '  '.repeat(indent);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return quote(value);
    case 'number':
    case 'boolean':
      return String(value);
    default:
      break;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) {
      const line = `[${value.map((item) => renderLiteral(item)).join(', ')}]`;
      if (close.length + line.length + 1 <= lineWidth) return line;
    }
    return `[\n${value.map((item) => `${pad}${renderLiteral(item, indent + 1)},\n`).join('')}${close}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (members.length === 0) return '{}';
    return `{\n${members
      .map(
        ([key, member]) =>
          `${pad}${identifier.test(key) ? key : quote(key)}: ${renderLiteral(member, indent + 1)},\n`,
      )
      .join('')}${close}}`;
  }
  throw new TypeError(`a ${typeof value} cannot be written into a migration file`);
}
