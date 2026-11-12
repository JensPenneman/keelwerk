import type { CoreLiteral } from '../core-module/core-type.ts';
import type { MemberOf } from './member-of.ts';

type RulesOf<Sec> = MemberOf<Sec, 'policies'>;

/** The module-level action of the core a contribution may add a rule to (`contributableCoreActions`). */
type ContributableCoreAction = CoreLiteral['actions']['eraseSubject'];

/** Whether a rule on an action the section does not mount covers the one contributable core action under its own key. */
type CoversCoreAction<K extends string, T, Contributed extends boolean> = Contributed extends true
  ? K extends 'eraseSubject'
    ? [T] extends [ContributableCoreAction]
      ? true
      : false
    : false
  : false;

type RuleCovers<Sec, K extends string, R, Contributed extends boolean> = R extends {
  readonly target: infer T;
}
  ? T extends string
    ? [T] extends [K]
      ? true
      : false
    : K extends keyof MemberOf<Sec, 'actions'>
      ? [MemberOf<Sec, 'actions'>[K]] extends [T]
        ? true
        : false
      : CoversCoreAction<K, T, Contributed>
  : true;

type UncoveredRules<Sec, K extends string, Rs, Contributed extends boolean> = {
  [N in keyof Rs]: RuleCovers<Sec, K, Rs[N], Contributed> extends true
    ? never
    : `${K}.${N & string}`;
}[keyof Rs];

/**
 * Policy keys that name a target one of their rules does not cover, in one behaviour section
 * (decision 105). `Contributed` is true for the members of `contributes`, which may also mount a
 * rule on the core's contributable action under its own key.
 */
export type UnknownPolicyTargetsIn<Sec, Contributed extends boolean = false> = {
  [K in keyof RulesOf<Sec> & string]: UncoveredRules<Sec, K, RulesOf<Sec>[K], Contributed>;
}[keyof RulesOf<Sec> & string];
