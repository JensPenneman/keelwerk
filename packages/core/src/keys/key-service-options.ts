import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';
import type { KeyCacheOptions } from './key-cache.ts';
import type { MasterKeySource } from './master-key-source.ts';
import type { RandomSource } from './random-source.ts';

/** What the key service needs from the runtime. */
export interface KeyServiceOptions {
  readonly master: MasterKeySource;
  /** The deployment's id: the scope id of the deployment key. */
  readonly deploymentId: string;
  /**
   * Runs `fn` in a deployment-scope unit and commits it when `fn` returns (S-55): the service
   * reads and creates wrapped scope keys only through it.
   */
  readonly withScopeKeys: <T>(fn: (keys: ScopeKeyStore) => Promise<T>) => Promise<T>;
  readonly clock: Clock;
  /** Every random draw (new keys, public ids, secrets, nonces); the recorded source in replay (decision 77). */
  readonly random?: RandomSource;
  /** Receives the reason of each reveal; never key material or values. */
  readonly log?: Logger;
  /** The cache of unwrapped scope keys; 60 seconds and 1,024 entries by default. */
  readonly cache?: KeyCacheOptions;
}
