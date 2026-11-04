import type { Empty } from '../types/empty.ts';

/** The fields of an entity or entity patch. */
export type FieldsOf<En> = [En] extends [{ readonly fields: infer F }] ? F : Empty;
