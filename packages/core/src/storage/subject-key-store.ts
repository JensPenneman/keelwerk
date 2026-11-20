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
  /**
   * The subject's data keys whose material is destroyed, by key id, with the instant each was
   * destroyed (the keys a shred destroyed now or before). A read: it works in a read-only unit.
   */
  shreddedKeys(
    subjectId: string,
  ): Promise<readonly { readonly keyId: string; readonly shreddedAt: Temporal.Instant }[]>;
  addRefs(subjectId: string, streams: readonly StreamRef[]): Promise<void>;
  refs(subjectId: string, after: StreamRef | null, limit: number): Promise<readonly StreamRef[]>;
  /** Wraps other keys (per-blob keys) under the subject's data key. */
  wrap(subjectId: string, key: Uint8Array): Promise<Uint8Array>;
  unwrap(subjectId: string, wrapped: Uint8Array): Promise<Uint8Array | undefined>;
  /**
   * Value keys: one per sealed value. The key of credential material is destroyed when the value
   * is replaced; the key of a command's request record is never replaced and goes at erasure. With
   * `keyId` the value is sealed under the key of that id, created on first use, so one long-lived
   * key serves many values (the binding is the one the key was created with) and destroying it
   * makes all of them unreadable.
   */
  sealValue(
    binding: { readonly entity: string; readonly id: string; readonly field: string },
    plain: Uint8Array,
    options?: { readonly keyId: string },
  ): Promise<SealedValue>;
  /** Which of these value keys exist (not destroyed), in the order given. */
  liveValueKeys(keyIds: readonly string[]): Promise<readonly string[]>;
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
