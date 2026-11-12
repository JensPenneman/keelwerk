const anyCase: RegExp =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/**
 * The one text of a data subject: the lower-case hyphenated UUID (8-4-4-4-12). A subject is 128
 * opaque bits, written as that UUID or as 32 hex digits, in either case; every comparison of
 * subjects and everything keyed by a subject (a store, a set, a lock, an id) goes through this
 * form. A text that is not a 128-bit value is not a subject id and comes back unchanged.
 */
export function canonicalSubject(text: string): string {
  if (!anyCase.test(text)) return text;
  const compact = text.replaceAll('-', '').toLowerCase();
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-');
}
