import type { Empty } from '../types/empty.ts';

/** A normaliser and its version; a changed id or version rebuilds the field's indexes (section 14.7.9.3). */
export interface NormalizerRef {
  readonly id: 'exact' | 'nfc' | 'caseless' | 'email' | (string & Empty);
  readonly version: number;
}
