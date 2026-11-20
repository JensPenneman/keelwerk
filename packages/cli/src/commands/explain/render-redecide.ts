/** `<part> <commandId>: reproduces` or `...: differs`, then `  - <difference>` per line, then `  refused: <code>` when set. */
export function renderRedecide(value: Readonly<Record<string, unknown>>): string {
  const differences = Array.isArray(value.differences) ? (value.differences as unknown[]) : [];
  const lines = [
    `${String(value.part)} ${String(value.commandId)}: ${value.reproduced === true ? 'reproduces' : 'differs'}`,
    ...differences.map((difference) => `  - ${String(difference)}`),
  ];
  if (typeof value.refused === 'string') lines.push(`  refused: ${value.refused}`);
  return lines.join('\n');
}
