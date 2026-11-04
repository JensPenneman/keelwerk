import type { newKinds } from './new-kinds.ts';

/** A kind of part `keelwerk new` scaffolds. */
export type NewKind = (typeof newKinds)[number];
