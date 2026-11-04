/** A JSON file's text: two-space indent and a final newline. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
