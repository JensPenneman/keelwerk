import type { StreamRef } from '../events/stream-ref.ts';
import type { DataKey } from './data-key.ts';
import type { SealedValue } from './sealed-value.ts';

/** Subject keys, per-value keys and subject references (section 14.7.4). */
export interface SubjectKeyStore {
  /** The subject's current data key, created on first use when `create` is set; undefined once shredded. */
  dataKey(subjectId: string, options: { readonly create: boolean }): Promise<DataKey | undefined>;
  /** A specific key version, to decrypt older values; undefined once shredded. */
  keyById(keyId: string): Promise<DataKey | undefined>;
  /** Destroys every key version of the subject, keeping rows with `shredded_at` and no key material. */
  shred(subjectId: string): Promise<{ readonly keyIds: readonly string[] }>;
  addRefs(subjectId: string, streams: readonly StreamRef[]): Promise<void>;
  refs(subjectId: string, after: StreamRef | null, limit: number): Promise<readonly StreamRef[]>;
  /** Wraps other keys (per-blob keys) under the subject's data key. */
  wrap(subjectId: string, key: Uint8Array): Promise<Uint8Array>;
  unwrap(subjectId: string, wrapped: Uint8Array): Promise<Uint8Array | undefined>;
  /** Value keys of credential material: one per sealed value, destroyed when the value is replaced. */
  sealValue(
    binding: { readonly entity: string; readonly id: string; readonly field: string },
    plain: Uint8Array,
  ): Promise<SealedValue>;
  /**
   * The value of a sealed text; undefined once its key is destroyed. With `expected`, also
   * undefined when the key was sealed for another binding (entity, row id and field), so a text
   * moved to another row, effect or receipt does not open there.
   */
  openValue(
    sealed: SealedValue,
    expected?: { readonly entity: string; readonly id: string; readonly field: string },
  ): Promise<Uint8Array | undefined>;
  destroyValueKey(keyId: string): Promise<void>;
}
