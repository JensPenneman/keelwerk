import type { EventMeta } from './event-meta.ts';
import type { Hlc } from './hlc.ts';

/** An event as the kernel hands it to the store; the store adds the position, version and namespace. */
export interface NewEvent {
  readonly eventId: string;
  /** Local name: 'changed', 'deactivated'. */
  readonly name: string;
  readonly schemaVersion: number;
  /** Personal values already encrypted. */
  readonly data: unknown;
  readonly before: unknown | null;
  readonly hlc: Hlc;
  readonly recordedAt: Temporal.Instant;
  readonly meta: EventMeta;
  readonly transient: boolean;
  readonly prevHash: string | null;
  readonly hash: string | null;
}
