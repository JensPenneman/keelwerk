import type { EntityNames } from './entities-of.ts';
import type { OwnEntityValue } from './entity-name-of.ts';
import type { BaseOf, ContributionTargetOf } from './part-source.ts';

/** What an entity part is mounted on: an own entity by value, or a contribution target's entity by name. */
export type EntityTargetOf<S> = OwnEntityValue<BaseOf<S>> | EntityNames<ContributionTargetOf<S>>;
