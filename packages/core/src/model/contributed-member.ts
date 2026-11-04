import type { ContractsIn } from './contracts-in.ts';
import type { ContributionsOf } from './contributions-of.ts';
import type { ModuleIdsIn } from './module-ids-in.ts';
import type { PresentContracts, PresentIds } from './present-modules.ts';
import type { UnionToIntersection } from './union-to-intersection.ts';

/** A declaration's `when` list is satisfied in a part that sees the modules and contracts of `W` as present. */
export type ActiveIn<B, W, When> = [
  | Exclude<ModuleIdsIn<When>, PresentIds<B, W>>
  | Exclude<ContractsIn<When, 'app'>, PresentContracts<B, W>>,
] extends [never]
  ? true
  : false;

/** What a module contributes to entity `E` of module `ToId` under `Member` ('fields' or 'relations'), from contributions active in the part. */
export type ContributedMember<
  B,
  W,
  ToId extends string,
  E extends string,
  Member extends 'fields' | 'relations',
> = UnionToIntersection<
  {
    [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
      readonly to: { readonly id: ToId };
      readonly when: infer When;
      readonly entities: { readonly [P in E]: { readonly [M in Member]: infer F } };
    }
      ? ActiveIn<B, W, When> extends true
        ? F
        : never
      : never;
  }[keyof ContributionsOf<B>]
>;

/** The fields a module contributes to entity `E` of module `ToId`, from contributions active in the part. */
export type ContributedFields<B, W, ToId extends string, E extends string> = ContributedMember<
  B,
  W,
  ToId,
  E,
  'fields'
>;
