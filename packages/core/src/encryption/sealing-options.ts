import type { KeyService } from '../kernel/key-service.ts';
import type { RandomSource } from '../keys/random-source.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { NormalizerRegistry } from './normalizer-registry.ts';

/** What the kernel's sealing layer needs besides a unit. */
export interface SealingOptions {
  /** Index root keys come from here (14.7.9.7). */
  readonly keys: Pick<KeyService, 'derive'>;
  /** The descriptor of an entity of the namespace's app: relation targets and subject paths. */
  readonly describe: (namespace: NamespaceRef, ref: string) => EntityDescriptor | undefined;
  /** The adapter's `encryptedQueries.maxScan`: the bound of the scan fallback (S-37). */
  readonly maxScan: number;
  /** Default: the four built-in normalisers. */
  readonly normalizers?: NormalizerRegistry;
  /** The draw behind every nonce; default: the operating system's source. */
  readonly random?: RandomSource;
}
