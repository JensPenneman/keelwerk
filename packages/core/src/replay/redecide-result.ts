import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import type { ComparableEvent } from './comparable-event.ts';

/** What a re-decide found: both sides and the differences between them. Nothing was committed. */
export interface RedecideResult {
  readonly commandId: string;
  /** The action's reference. */
  readonly part: string;
  /** Whether events, effects, decision record and flags all came out as recorded. */
  readonly reproduced: boolean;
  /** One line per difference, empty when reproduced. */
  readonly differences: readonly string[];
  /** The code of the replay limit that stopped the re-decide (`core.replay_outside_horizon`, `core.replay_key_destroyed`), when one did. */
  readonly refused?: string;
  readonly recorded: {
    readonly events: readonly ComparableEvent[];
    /** The requested effect ids. */
    readonly effects: readonly string[];
    readonly decision: EncodedDecisionRecord;
  };
  readonly redecided: {
    readonly events: readonly ComparableEvent[];
    /** The kinds of the effects the decision requested, in order. */
    readonly effects: readonly string[];
    /** Absent when the handler failed before it decided. */
    readonly decision?: EncodedDecisionRecord;
    readonly result?: unknown;
  };
}
