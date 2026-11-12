/**
 * The payload of the kernel event `erased` (section 14.7.5 step 3, S-168). Stored and final once
 * written; it carries names, never values.
 */
export interface ErasedEventData {
  readonly subjectId: string;
  /** Field names cleared, sorted; never values. */
  readonly fields: readonly string[];
  /** The row's data subject is the subject: the row becomes an erased tombstone. */
  readonly owned: boolean;
}
