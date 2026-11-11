/** U+0000 as `JSON.stringify` writes it (`\u0000`), not preceded by an escaped backslash. */
const nulEscape = /(?:^|[^\\])(?:\\\\)*\\u0000/;

/**
 * Whether JSON text written by `JSON.stringify` holds U+0000 in a string or a member name. `jsonb`
 * cannot keep it, so a stream record that holds it is refused before it is sealed or stored.
 */
export function jsonHoldsNul(text: string): boolean {
  return nulEscape.test(text);
}
