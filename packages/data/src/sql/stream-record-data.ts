import { jsonHoldsLoneSurrogate } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';

/** `\u0000` as JSON text writes it, not preceded by an escaped backslash. */
const nulEscape = /(?:^|[^\\])(?:\\\\)*\\u0000/;

/**
 * The `data` JSON text of a record: `{"record": …}` (the form is final from the first write, so an
 * offload reference record, `{"offload": …}`, is told apart without a column). A record whose JSON
 * holds U+0000 is refused, because `jsonb` cannot keep it, and so is one holding a lone surrogate
 * in a text or a member name (`jsonb` refuses its `\ud83d` escape too); every adapter refuses both alike.
 */
export function streamRecordData(record: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify({ record });
  } catch {
    text = undefined;
  }
  if (text === undefined || !text.startsWith('{"record":')) {
    throw malformedQuery('a stream record must be JSON');
  }
  if (nulEscape.test(text)) throw malformedQuery('a stream record cannot hold U+0000');
  if (jsonHoldsLoneSurrogate(text)) {
    throw malformedQuery('a stream record cannot hold a lone surrogate');
  }
  return text;
}
