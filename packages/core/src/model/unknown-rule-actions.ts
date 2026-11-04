import type { SectionsOf } from './sections-of.ts';
import type { UnknownRuleActionsIn } from './unknown-rule-actions-in.ts';

/** Rule action names no target mounts, over the module literal and its contribution and conditional sections. */
export type UnknownRuleActions<L> =
  SectionsOf<L> extends infer Sec
    ? Sec extends unknown
      ? UnknownRuleActionsIn<Sec>
      : never
    : never;
