import type { AnyModule } from './any-module.ts';
import type { DependencyRow } from './dependency-row.ts';
import type { OwnRow } from './own-row.ts';
import type { BaseOf, ContributionTargetOf, WhenOf } from './part-source.ts';
import type { TargetName } from './target-name.ts';

/** The full current row an entity command receives: the module's row type of the target. */
export type CurrentRow<S, T> = T extends string
  ? ContributionTargetOf<S> extends infer D extends AnyModule
    ? DependencyRow<BaseOf<S>, WhenOf<S>, D, T>
    : never
  : OwnRow<BaseOf<S>, TargetName<S, T>>;
