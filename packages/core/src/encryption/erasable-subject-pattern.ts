/**
 * The text of a data subject an erasure accepts: a lower-case UUID (8-4-4-4-12) or exactly 32
 * lower-case hex digits, the form the auth module has written since its first release. Both are 128
 * opaque bits and hold no typed value, so the ledger, the receipt and the job never carry personal
 * text. The subject columns of the key tables are uuid columns, which read both forms.
 */
export const erasableSubjectPattern: RegExp =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/;
