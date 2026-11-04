import type { SectionsOf } from './sections-of.ts';
import type { UnknownPolicyTargetsIn } from './unknown-policy-targets-in.ts';

/** Policy keys that name a target their rule does not cover, over the module literal and its sections. */
export type UnknownPolicyTargets<L> =
  SectionsOf<L> extends infer Sec
    ? Sec extends unknown
      ? UnknownPolicyTargetsIn<Sec>
      : never
    : never;
