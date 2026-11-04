import type { ConditionsOf } from './conditions-of.ts';
import type { UnionToIntersection } from './union-to-intersection.ts';

/** The fields a module's conditional parts add to one of its own entities. */
export type ConditionalFields<B, E extends string> = UnionToIntersection<
  {
    [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends {
      readonly entities: { readonly [P in E]: { readonly fields: infer F } };
    }
      ? F
      : never;
  }[keyof ConditionsOf<B>]
>;
