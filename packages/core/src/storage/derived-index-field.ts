import type { PersonalQuery } from './personal-query.ts';

/** An index field of a personal field (section 14.7.9.6). */
export interface DerivedIndexField {
  /** The personal field it serves. */
  readonly field: string;
  /** Blind index tag, prefix or trigram tags, order token. */
  readonly kind: 'binary' | 'tagSet' | 'ore';
  /** The capability it answers (section 14.7.9.2). */
  readonly query: PersonalQuery;
  readonly column: string;
  /** The index key version (section 14.7.9.7). */
  readonly keyVersion: number;
}
