/** What happens to a value whose key is shredded or that was moved: it stays sealed, reads as absent, or reads as `{ redacted: true }` (history). */
export type SealedMembers = 'keep' | 'drop' | 'redact';
