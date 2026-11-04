import type { Clock, EntityDescriptor } from '@keelwerk/core';
import type { SqlKeyWrapper } from '@keelwerk/data';
import type { AccelerationOptions } from './acceleration-options.ts';

/** What `postgresAdapter` takes; every member is optional. */
export interface PostgresAdapterOptions extends AccelerationOptions {
  /** Tags the sessions in `pg_stat_activity`; default `keelwerk`. */
  readonly applicationName?: string;
  /** The time source of bucket refills and key timestamps; default: the system clock. */
  readonly clock?: Clock;
  /**
   * Finds the descriptor of a relation's target by entity ref. The adapter also learns every
   * descriptor a store call names, so this is needed only for a target no call has named yet.
   */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
  /**
   * The connection url of the role that owns the tables and runs migrations (14.3.7, decision 134).
   * When set, the schema operations (apply, provision, introspect, lock) connect with it; without it
   * `schema.apply` and `schema.provision` refuse as unsupported.
   */
  readonly ownerUrl?: string;
  /** Wraps the key material of `kw_subject_keys` and `kw_value_keys`; without it the key stores refuse. */
  readonly keyWrapper?: SqlKeyWrapper;
}
