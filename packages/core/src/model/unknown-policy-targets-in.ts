import type { MemberOf } from './member-of.ts';

type RulesOf<Sec> = MemberOf<Sec, 'policies'>;

type RuleCovers<Sec, K extends string, R> = R extends { readonly target: infer T }
  ? T extends string
    ? [T] extends [K]
      ? true
      : false
    : K extends keyof MemberOf<Sec, 'actions'>
      ? [MemberOf<Sec, 'actions'>[K]] extends [T]
        ? true
        : false
      : false
  : true;

type UncoveredRules<Sec, K extends string, Rs> = {
  [N in keyof Rs]: RuleCovers<Sec, K, Rs[N]> extends true ? never : `${K}.${N & string}`;
}[keyof Rs];

/** Policy keys that name a target one of their rules does not cover, in one behaviour section (decision 105). */
export type UnknownPolicyTargetsIn<Sec> = {
  [K in keyof RulesOf<Sec> & string]: UncoveredRules<Sec, K, RulesOf<Sec>[K]>;
}[keyof RulesOf<Sec> & string];
