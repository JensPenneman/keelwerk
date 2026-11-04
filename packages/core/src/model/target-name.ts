import type { EntityNameOf } from './entity-name-of.ts';
import type { BaseOf } from './part-source.ts';

/** The entity name of a mount. */
export type TargetName<S, T> = (T extends string ? T : EntityNameOf<BaseOf<S>, T>) & string;
