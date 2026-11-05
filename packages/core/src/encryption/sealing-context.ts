import type { RandomSource } from '../keys/random-source.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { Unit } from '../storage/unit.ts';
import type { IndexKeys } from './index-keys.ts';
import type { NormalizerRegistry } from './normalizer-registry.ts';

/** The sealing layer's view of one raw unit. */
export interface SealingContext {
  /** The adapter's unit, below the sealing layer. */
  readonly unit: Unit;
  readonly describe: (ref: string) => EntityDescriptor | undefined;
  readonly normalizers: NormalizerRegistry;
  readonly indexKeys: IndexKeys;
  readonly random: RandomSource;
  readonly maxScan: number;
  /** The subject's current data key, created on first use; `forbidden` once the subject is erased. */
  dataKey(subjectId: string): Promise<DataKey>;
  /** A data key by id, kept for the unit; `undefined` once shredded. */
  keyById(keyId: string): Promise<DataKey | undefined>;
}
