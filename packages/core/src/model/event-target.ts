import type { TargetName } from './target-name.ts';

/** The target entity of `ctx.events`: own entities only. */
export type EventTarget<S, T> = T extends string ? never : TargetName<S, T>;
