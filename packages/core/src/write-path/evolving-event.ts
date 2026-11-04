import type { Hlc } from '../events/hlc.ts';

/** What an evolve function needs of an event: the stream, the name, the payload in event form and the envelope members the row records. */
export interface EvolvingEvent {
  /** The stream id: the row's id. */
  readonly id: string;
  /** The local name: 'created', 'changed', 'archived', 'restored', or a domain event. */
  readonly name: string;
  readonly data: unknown;
  readonly recordedAt: Temporal.Instant;
  readonly hlc: Hlc;
  readonly hash: string | null;
}
