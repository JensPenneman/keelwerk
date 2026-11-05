/** What happens to a value whose key is shredded or that was moved: it stays sealed, or reads as absent. */
export type SealedMembers = 'keep' | 'drop';
