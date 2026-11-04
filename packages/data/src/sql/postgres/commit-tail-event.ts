/** One event of a commit tail, encoded for the statement's text arrays (section 15.1.2). */
export interface CommitTailEvent {
  readonly streamType: string;
  readonly streamId: string;
  readonly streamVersion: number;
  readonly partition: string | null;
  readonly eventId: string;
  readonly name: string;
  /** `NewEvent.schemaVersion`, part of the hash input (15.1.8). */
  readonly schemaVersion: number;
  /** Hexadecimal text of the `shape_id` bytes. */
  readonly shapeHex: string;
  /** JSON text. */
  readonly data: string;
  /** JSON text, or null for no before-image. */
  readonly before: string | null;
  /** JSON text. */
  readonly meta: string;
  readonly hlc: string;
  /** ISO 8601 instant text. */
  readonly recordedAt: string;
  readonly transient: boolean;
  /** Hexadecimal SHA-256, or null. */
  readonly prevHash: string | null;
  readonly hash: string | null;
}
