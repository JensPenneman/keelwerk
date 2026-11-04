import type { DataKey, StreamRef, SubjectKeyStore } from '@keelwerk/core';
import { compareCodePoints, errors, newUuidV7 } from '@keelwerk/core';
import { memoryOpen } from './memory-open.ts';
import { memorySeal } from './memory-seal.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface SubjectKey {
  readonly keyId: string;
  readonly subjectId: string;
  /** Absent once shredded. */
  readonly material: Uint8Array | null;
  readonly createdAt: Temporal.Instant;
  readonly shreddedAt: Temporal.Instant | null;
}

interface ValueKey {
  readonly keyId: string;
  readonly material: Uint8Array;
  /** The associated data of the sealed value: entity, row id and field. */
  readonly aad: Uint8Array;
}

const encoder = new TextEncoder();

function dataKeyOf(record: SubjectKey): DataKey | undefined {
  return record.material === null
    ? undefined
    : { id: record.keyId, material: record.material.slice() };
}

/**
 * Subject keys, value keys and subject references of the unit's scope (14.7.4). The store keeps
 * key material in process memory, never beyond the adapter's life, so it needs no wrapping key;
 * `wrap` and `unwrap` still seal other keys under the subject's data key, so shredding makes them
 * unreadable. Shredded rows keep their metadata and lose the material.
 */
export function memoryKeyStore(ctx: MemoryUnitContext): SubjectKeyStore {
  const subjects = (): string => `subjectkeys/${ctx.scopeId()}`;
  const values = (): string => `valuekeys/${ctx.scopeId()}`;
  const refsName = (): string => `subjectrefs/${ctx.scopeId()}`;
  const recordsOf = (subjectId: string): SubjectKey[] =>
    [...ctx.tx.read<SubjectKey>(subjects()).values()]
      .filter((record) => record.subjectId === subjectId)
      .sort((a, b) => compareCodePoints(a.keyId, b.keyId));
  const dataKey = async (
    subjectId: string,
    options: { readonly create: boolean },
  ): Promise<DataKey | undefined> => {
    const records = recordsOf(subjectId);
    const active = records.findLast((record) => record.material !== null);
    if (active !== undefined) return dataKeyOf(active);
    if (records.length > 0 || !options.create) return undefined;
    ctx.writable();
    const record: SubjectKey = {
      keyId: newUuidV7(),
      subjectId,
      material: crypto.getRandomValues(new Uint8Array(32)),
      createdAt: ctx.clock.now(),
      shreddedAt: null,
    };
    ctx.tx.write<SubjectKey>(subjects()).set(record.keyId, record);
    return dataKeyOf(record);
  };
  return {
    dataKey,
    keyById: async (keyId) => {
      const record = ctx.tx.read<SubjectKey>(subjects()).get(keyId);
      return record === undefined ? undefined : dataKeyOf(record);
    },
    shred: async (subjectId) => {
      ctx.writable();
      const live = recordsOf(subjectId).filter((record) => record.material !== null);
      if (live.length === 0) return { keyIds: [] };
      const table = ctx.tx.write<SubjectKey>(subjects());
      const at = ctx.clock.now();
      for (const record of live)
        table.set(record.keyId, { ...record, material: null, shreddedAt: at });
      return { keyIds: live.map((record) => record.keyId) };
    },
    addRefs: async (subjectId, streams) => {
      ctx.writable();
      const table = ctx.tx.write<{ readonly subjectId: string; readonly stream: StreamRef }>(
        refsName(),
      );
      for (const stream of streams) {
        table.set(`${subjectId}\u0000${stream.type}\u0000${stream.id}`, { subjectId, stream });
      }
    },
    refs: async (subjectId, after, limit) =>
      [
        ...ctx.tx
          .read<{ readonly subjectId: string; readonly stream: StreamRef }>(refsName())
          .values(),
      ]
        .filter((ref) => ref.subjectId === subjectId)
        .map((ref) => ref.stream)
        .sort((a, b) => compareCodePoints(a.type, b.type) || compareCodePoints(a.id, b.id))
        .filter(
          (stream) =>
            after === null ||
            compareCodePoints(stream.type, after.type) > 0 ||
            (stream.type === after.type && compareCodePoints(stream.id, after.id) > 0),
        )
        .slice(0, limit),
    wrap: async (subjectId, key) => {
      const data = await dataKey(subjectId, { create: true });
      if (data === undefined)
        throw errors.not_found(`the keys of subject ${subjectId} were shredded`);
      const id = encoder.encode(data.id);
      const sealed = await memorySeal(data.material, key, id);
      const wrapped = new Uint8Array(
        1 + id.length + sealed.nonce.length + sealed.ciphertext.length,
      );
      wrapped[0] = id.length;
      wrapped.set(id, 1);
      wrapped.set(sealed.nonce, 1 + id.length);
      wrapped.set(sealed.ciphertext, 1 + id.length + sealed.nonce.length);
      return wrapped;
    },
    unwrap: async (subjectId, wrapped) => {
      const idLength = wrapped[0] ?? 0;
      const keyId = new TextDecoder().decode(wrapped.subarray(1, 1 + idLength));
      const record = ctx.tx.read<SubjectKey>(subjects()).get(keyId);
      if (record === undefined || record.subjectId !== subjectId || record.material === null) {
        return undefined;
      }
      const nonce = wrapped.subarray(1 + idLength, 13 + idLength);
      return memoryOpen(
        record.material,
        nonce,
        wrapped.subarray(13 + idLength),
        encoder.encode(keyId),
      );
    },
    sealValue: async (binding, plain) => {
      ctx.writable();
      const keyId = newUuidV7();
      const material = crypto.getRandomValues(new Uint8Array(32));
      const aad = encoder.encode([binding.entity, binding.id, binding.field].join('\u0000'));
      const sealed = await memorySeal(material, plain, aad);
      ctx.tx.write<ValueKey>(values()).set(keyId, { keyId, material, aad });
      return { keyId, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
    },
    openValue: async (sealed) => {
      const record = ctx.tx.read<ValueKey>(values()).get(sealed.keyId);
      if (record === undefined) return undefined;
      return memoryOpen(record.material, sealed.nonce, sealed.ciphertext, record.aad);
    },
    destroyValueKey: async (keyId) => {
      ctx.writable();
      if (!ctx.tx.read<ValueKey>(values()).has(keyId)) return;
      ctx.tx.write<ValueKey>(values()).delete(keyId);
    },
  };
}
