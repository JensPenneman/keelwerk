import type { Clock, EntityDescriptor } from '@keelwerk/core';
import type { SqlKeyWrapper } from '@keelwerk/data';

/** What `postgresAdapter` takes; every member is optional. */
export interface PostgresAdapterOptions {
  /** Tags the sessions in `pg_stat_activity`; default `keelwerk`. */
  readonly applicationName?: string;
  /** The time source of bucket refills and key timestamps; default: the system clock. */
  readonly clock?: Clock;
  /**
   * Finds the descriptor of a relation's target by entity ref. The adapter also learns every
   * descriptor a store call names, so this is needed only for a target no call has named yet.
   */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
  /** Wraps the key material of `kw_subject_keys` and `kw_value_keys`; without it the key stores refuse. */
  readonly keyWrapper?: SqlKeyWrapper;
}
