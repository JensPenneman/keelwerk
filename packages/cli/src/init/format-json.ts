const width = 100;

function isPrimitive(value: unknown): boolean {
  return typeof value !== 'object' || value === null;
}

function render(value: unknown, indent: string, inline: boolean): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (inline && value.every(isPrimitive)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (indent.length + inline.length + 20 <= width) return inline;
    }
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${render(item, inner, inline)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    return `{\n${entries
      .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, inner, inline)}`)
      .join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * JSON text the way Biome formats it: objects expanded, short arrays of plain values on one line,
 * a final newline. Biome keeps every array of a `package.json` expanded, which `expanded` asks for.
 */
export function formatJson(value: unknown, expanded = false): string {
  return `${render(value, '', !expanded)}\n`;
}
