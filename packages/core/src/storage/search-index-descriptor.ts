/** A plaintext search index (capability `search`) or a keyed token index over personal fields (section 14.7.9.9). */
export interface SearchIndexDescriptor {
  readonly name: string;
  readonly fields: readonly string[];
  readonly form: 'native' | 'tokens';
  /** Token indexes only. */
  readonly keys: 'tenant' | 'subject' | null;
  readonly languages: readonly string[];
}
