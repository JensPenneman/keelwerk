import type { PersonalFlags } from './personal-flags.ts';

/** Merge types of offline sync (section 15.3.4). */
export type MergeType =
  | 'lww'
  | 'exclusive'
  | 'counter'
  | 'max'
  | 'min'
  | 'set'
  | 'sequence'
  | 'richText';

/** The flags of a fresh field. */
export interface NoFlags {
  readonly optional: false;
  readonly defaulted: false;
  readonly unique: false;
  readonly indexed: false;
  readonly hidden: false;
  readonly maskable: false;
  readonly personal: false;
  readonly stateOnly: false;
  readonly merge: null;
  readonly tag: null;
}

/** `F` with flag `K` set to `V`, every other flag kept. */
export type WithFlag<F extends FieldFlags, K extends keyof FieldFlags, V extends FieldFlags[K]> = {
  readonly [P in keyof FieldFlags]: P extends K ? V : F[P];
};

/** Every flag a modifier can set; each modifier keeps all the others (section 4.2). */
export interface FieldFlags {
  readonly optional: boolean;
  readonly defaulted: boolean;
  readonly unique: boolean;
  readonly indexed: boolean;
  readonly hidden: boolean;
  readonly maskable: boolean;
  readonly personal: false | PersonalFlags;
  readonly stateOnly: boolean;
  readonly merge: MergeType | null;
  readonly tag: number | null;
}
