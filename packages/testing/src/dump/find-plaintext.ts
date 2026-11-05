const hexRun = /\\x([0-9a-fA-F]{8,})/g;
const base64Run = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

/** The texts a stored byte string can show: as Latin-1, UTF-8 and UTF-16 (little and big endian). */
function readings(bytes: Buffer): readonly string[] {
  const swapped = Buffer.from(bytes);
  if (swapped.length % 2 === 0) swapped.swap16();
  return [
    bytes.toString('latin1'),
    bytes.toString('utf8'),
    bytes.toString('utf16le'),
    swapped.toString('utf16le'),
  ];
}

/**
 * The markers a dump shows in plaintext (14.10): looked up, ignoring case, in the dump itself, in
 * every `\x` hex string read as bytes, and in every base64 or base64url run read as bytes, so a
 * value kept in a bytea column or in encoded form is found as well as one kept as text. A sealed
 * value (AES-GCM) shows none of the markers; an empty answer is the pass.
 */
export function findPlaintext(dump: string, markers: readonly string[]): readonly string[] {
  const texts: string[] = [dump];
  for (const match of dump.matchAll(hexRun)) {
    const hex = match[1] ?? '';
    texts.push(...readings(Buffer.from(hex.length % 2 === 0 ? hex : hex.slice(0, -1), 'hex')));
  }
  for (const match of dump.matchAll(base64Run)) {
    const run = match[0];
    texts.push(...readings(Buffer.from(run, 'base64url')), ...readings(Buffer.from(run, 'base64')));
  }
  const haystack = texts.join('\n').toLowerCase();
  return markers.filter((marker) => haystack.includes(marker.toLowerCase()));
}
