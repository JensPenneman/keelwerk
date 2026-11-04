/** Whether a prefix may head a token: lower-case letters and digits, starting with a letter, at most 16. */
export function isTokenPrefix(prefix: string): boolean {
  return /^[a-z][a-z0-9]{0,15}$/.test(prefix);
}
