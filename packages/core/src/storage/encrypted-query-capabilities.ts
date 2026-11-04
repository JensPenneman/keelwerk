/** What an adapter does for queries over personal fields (section 14.7.9.10). */
export interface EncryptedQueryCapabilities {
  /** Tag columns with unique and partial indexes. */
  readonly equality: boolean;
  /** Prefix, trigram and token tags. */
  readonly tagSets: 'array' | 'table' | false;
  /** ORE comparison in the database. */
  readonly order: 'ore' | false;
  /** Bound of a scan's limit. */
  readonly maxScan: number;
}
