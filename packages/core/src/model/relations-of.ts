import type { Empty } from '../types/empty.ts';

/** The relations of an entity or entity patch. */
export type RelationsOf<En> = [En] extends [{ readonly relations: infer R }] ? R : Empty;
