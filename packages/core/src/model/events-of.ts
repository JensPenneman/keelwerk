import type { Empty } from '../types/empty.ts';

/** The domain events of an entity. */
export type EventsOf<En> = [En] extends [{ readonly events: infer Ev }] ? Ev : Empty;
