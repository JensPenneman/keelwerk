import type { MemberOf } from './member-of.ts';
import type { UnknownPolicyTargetsIn } from './unknown-policy-targets-in.ts';

type InMembers<M, Contributed extends boolean> = {
  [K in keyof M]: UnknownPolicyTargetsIn<M[K], Contributed>;
}[keyof M];

/** Policy keys that name a target their rule does not cover, over the module literal and its sections. */
export type UnknownPolicyTargets<L> =
  | UnknownPolicyTargetsIn<L>
  | InMembers<MemberOf<L, 'contributes'>, true>
  | InMembers<MemberOf<L, 'conditional'>, false>;
