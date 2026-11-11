/**
 * A lone surrogate as `JSON.stringify` writes it (`\ud83d`): it escapes only the unpaired ones, so
 * a pair stays a character. Not preceded by an escaped backslash, which would make it plain text.
 */
const loneSurrogateEscape = /(?:^|[^\\])(?:\\\\)*\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

/**
 * Whether JSON text written by `JSON.stringify` holds a lone UTF-16 surrogate in a string or a
 * member name. Such a value has no UTF-8 form: `jsonb` refuses it and an encoder turns it into
 * U+FFFD, so every store of JSON values refuses it alike.
 */
export function jsonHoldsLoneSurrogate(text: string): boolean {
  return loneSurrogateEscape.test(text);
}
