const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32 of bytes, lower case, no padding. */
function base32Of(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32Alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += base32Alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * The characters of an encoding of `bytes` that do not depend on what stands next to them: when a
 * value sits inside a longer encoded text, only the symbols that are made entirely of its own bits
 * are the same as in its own encoding. `bitsPerSymbol` is 6 for base64 and 5 for base32; `offset`
 * is the number of bytes in front of the value, which moves its symbols.
 */
function stable(
  encode: (bytes: Uint8Array) => string,
  bytes: Uint8Array,
  bitsPerSymbol: number,
  offset: number,
): string {
  const text = encode(Buffer.concat([Buffer.alloc(offset), bytes]));
  const from = Math.ceil((offset * 8) / bitsPerSymbol);
  const to = Math.floor(((offset + bytes.length) * 8) / bitsPerSymbol);
  return text.slice(from, to);
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const base64UrlOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** One way a value can appear in a dump. */
export interface MarkerForm {
  readonly form: string;
  readonly text: string;
  /** Hexadecimal and base32 are compared ignoring case; the base64 alphabets are not. */
  readonly foldCase: boolean;
}

/**
 * The forms a marker can take in a dump: as written, JSON-escaped, and its UTF-8 bytes in base64,
 * base64url, hexadecimal and base32, the three encodings that carry the value at every byte offset
 * of a longer text (3 for base64, 5 for base32).
 */
export function markerForms(marker: string): readonly MarkerForm[] {
  const bytes = Buffer.from(marker, 'utf8');
  const forms: MarkerForm[] = [
    { form: 'plain', text: marker, foldCase: true },
    { form: 'json', text: JSON.stringify(marker).slice(1, -1), foldCase: true },
    { form: 'hex', text: bytes.toString('hex'), foldCase: true },
  ];
  for (let offset = 0; offset < 3; offset += 1) {
    forms.push({
      form: `base64@${offset}`,
      text: stable(base64Of, bytes, 6, offset),
      foldCase: false,
    });
    forms.push({
      form: `base64url@${offset}`,
      text: stable(base64UrlOf, bytes, 6, offset),
      foldCase: false,
    });
  }
  for (let offset = 0; offset < 5; offset += 1) {
    forms.push({
      form: `base32@${offset}`,
      text: stable(base32Of, bytes, 5, offset),
      foldCase: true,
    });
  }
  return forms.filter((entry) => entry.text.length >= 8);
}

/** The `marker (form)` of every marker form that stands in `haystack`. */
export function formsFoundIn(haystack: string, markers: readonly string[]): readonly string[] {
  const folded = haystack.toLowerCase();
  const found: string[] = [];
  for (const marker of markers) {
    for (const entry of markerForms(marker)) {
      const present = entry.foldCase
        ? folded.includes(entry.text.toLowerCase())
        : haystack.includes(entry.text);
      if (present) found.push(`${marker} (${entry.form})`);
    }
  }
  return found;
}
