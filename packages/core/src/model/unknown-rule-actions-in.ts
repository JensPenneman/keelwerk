import type { BuiltinActionName } from './builtin-action-name.ts';
import type { MemberOf } from './member-of.ts';

type RulesOf<Sec> = MemberOf<Sec, 'policies'>;

type CustomActionsOf<Sec, T> = T extends string
  ? keyof MemberOf<MemberOf<Sec, 'entityActions'>, T> & string
  : never;

type UnknownActionsOfRule<Sec, K extends string, N extends string, R> = R extends {
  readonly target: infer T extends string;
  readonly actions: infer A extends readonly string[];
}
  ? Exclude<A[number], BuiltinActionName | CustomActionsOf<Sec, T>> extends infer Bad extends string
    ? string extends Bad
      ? never
      : [Bad] extends [never]
        ? never
        : `${K}.${N}.${Bad}`
    : never
  : never;

/** Custom action names a mounted rule names that its target does not mount, in one behaviour section (decision 105). */
export type UnknownRuleActionsIn<Sec> = {
  [K in keyof RulesOf<Sec> & string]: {
    [N in keyof RulesOf<Sec>[K] & string]: UnknownActionsOfRule<Sec, K, N, RulesOf<Sec>[K][N]>;
  }[keyof RulesOf<Sec>[K] & string];
}[keyof RulesOf<Sec> & string];
