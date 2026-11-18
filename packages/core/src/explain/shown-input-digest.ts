/**
 * What explain shows of a decision's stored `inputDigest`: the text itself when it is a decision
 * base (`kwb1.`), a rekeyed decision digest (`kwd1.`) or the digest of an inline reaction's causing
 * event (`kwr1.`) and 64 hex characters, else `withheld`: a digest of 0.1.0 is the plain SHA-256 of
 * the input, passwords included, and is never shown.
 */
export function shownInputDigest(digest: string): string {
  return /^kw[bdr]1\.[0-9a-f]{64}$/.test(digest) ? digest : 'withheld';
}
