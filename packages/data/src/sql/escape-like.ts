/**
 * Escapes the characters `LIKE` treats as wildcards (`%` and `_`) and the escape character itself
 * (`\`), so a user's text matches literally (section 14.3.4). Pair it with `escape '\'`.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
