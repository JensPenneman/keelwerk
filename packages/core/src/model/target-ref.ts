import type { ContributionTargetOf, OwnerOf } from './part-source.ts';
import type { TargetName } from './target-name.ts';

/** The reference of the mounted entity, 'module.entity'. */
export type TargetRef<S, T> =
  `${T extends string ? ContributionTargetOf<S>['id'] : OwnerOf<S>}.${TargetName<S, T>}`;
