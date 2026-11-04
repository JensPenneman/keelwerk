/** An event, change record or stream record a decision appends (section 7.9.2). */
export interface Draft {
  readonly kind: 'draft';
  readonly target: string;
  readonly type: string;
}

/** A kernel or external effect a decision requests; `O` is the outcome value of external effects. */
export interface EffectDraft<O = unknown> {
  readonly kind: 'effect';
  readonly type: string;
  readonly '~output'?: O;
}

/** What `decide` and `react` return: events alone, or events, effects and a result. */
export type Decision<O = void> =
  | readonly Draft[]
  | {
      readonly events?: readonly Draft[];
      readonly effects?: readonly EffectDraft[];
      readonly result?: O;
    };
