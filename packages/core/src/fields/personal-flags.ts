import type { PersonalQuery } from '../storage/personal-query.ts';

/** What the indexes of a personal field reveal (section 14.7.9.4). */
export type PersonalLeak =
  | 'presence'
  | 'length'
  | 'equality'
  | 'prefixes'
  | 'ngrams'
  | 'order'
  | 'tokens';

/** The leak a query capability adds. */
export type LeakOf<Q extends PersonalQuery> = Q extends 'eq'
  ? 'equality'
  : Q extends 'prefix'
    ? 'prefixes'
    : Q extends 'contains'
      ? 'ngrams'
      : Q extends 'order'
        ? 'order'
        : 'tokens';

/**
 * The personal flag in a field's type: the field holding the data subject (`null` for the entity's
 * `dataSubject`), the effective query capabilities (an implied `eq` included) and what they leak.
 */
export interface PersonalFlags<
  Q extends readonly PersonalQuery[] = readonly PersonalQuery[],
  S extends string | null = string | null,
> {
  readonly subject: S;
  readonly queries: Q;
  readonly leaks: readonly ('presence' | LeakOf<Q[number]>)[];
}
