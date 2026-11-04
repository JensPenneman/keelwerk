import type { Draft } from './draft.ts';
import type { EffectDraft } from './effect-draft.ts';

/** What `decide` and `react` return: events alone, or events, effects and a result. */
export type Decision<O = void> =
  | readonly Draft[]
  | {
      readonly events?: readonly Draft[];
      readonly effects?: readonly EffectDraft[];
      readonly result?: O;
    };
