import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';

/** One event a dry run would append, with the previous values of the fields it changed. */
export interface DryRunEvent {
  /** 'library.book/0192...'. */
  readonly stream: string;
  readonly version: number;
  /** 'library.book.created'. */
  readonly type: string;
  readonly eventId: string;
  /** JSON-safe: instants, big integers and bytes are text. */
  readonly data: unknown;
  /** The before-image of section 15.1.5; `null` when nothing eligible changed. */
  readonly before: unknown | null;
}

/** One effect the decision requested, with the id the real run would give it. */
export interface DryRunEffect {
  readonly id: string;
  readonly kind: string;
  /** The effect's type: an external effect's reference, else the kind's own name. */
  readonly type: string;
  /** The module action that receives an external effect's outcome. */
  readonly continuation?: string;
  /** The input the record holds, with hidden, personal and secret values redacted. */
  readonly input?: unknown;
}

/**
 * What a dry run reports (section 7.9.6): `decided` carries the events, the effects, the result
 * and the decision record; `would-perform` stops at the inline effect `prepare` asked for.
 */
export type DryRunReport =
  | {
      readonly status: 'decided';
      readonly commandId: string;
      readonly action: string;
      readonly events: readonly DryRunEvent[];
      readonly effects: readonly DryRunEffect[];
      /** The ids of the deferred effects, reactions' included (what the real run answers). */
      readonly deferred: readonly string[];
      readonly result: unknown;
      /** The command's decision record; `null` when the command wrote nothing, so no event carries it. */
      readonly decision: EncodedDecisionRecord | null;
    }
  | {
      readonly status: 'would-perform';
      readonly action: string;
      readonly effect: string;
      readonly input: unknown;
    };
