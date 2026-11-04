import type { PersonalQuery } from '../storage/personal-query.ts';
/** A pure normaliser with an identity: changing its id or version rebuilds the field's indexes (section 14.7.9.3). */
export interface CustomNormalizer {
  readonly id: string;
  readonly version: number;
  readonly normalize: (value: string) => string;
}

/** How a personal field's values are compared (section 14.7.9.3). */
export type Normalizer = 'exact' | 'nfc' | 'caseless' | 'email' | CustomNormalizer;

/** Options of `.personal()` (section 14.7.9.2). */
export interface PersonalOptions<
  Q extends readonly PersonalQuery[] = readonly PersonalQuery[],
  S extends string = string,
> {
  readonly subject?: S;
  readonly queries?: Q;
  readonly normalize?: Normalizer;
  readonly eq?: { readonly bits?: number };
  readonly prefix?: { readonly min?: number; readonly max?: number };
  readonly contains?: { readonly bits?: number };
  readonly order?: { readonly bytes?: number };
  readonly keys?: 'tenant' | 'subject';
}
