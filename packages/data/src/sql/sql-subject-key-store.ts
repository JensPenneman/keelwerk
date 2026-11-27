// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { DataKey, StreamRef, SubjectKeyStore } from '@keelwerk/core';
import { canonicalSubject, compareCodePoints, encodeAad, errors, newUuidV7 } from '@keelwerk/core';
import { CompiledQuery, sql } from 'kysely';
import { aadBinding } from './aad-binding.ts';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { decodeBytes } from './sql-bytes.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlKeyWrapper } from './sql-key-wrapper.ts';
import { sqlOpen } from './sql-open.ts';
import { sqlSeal } from './sql-seal.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const encoder = new TextEncoder();

/**
 * Subject keys, value keys and subject references of the unit's scope (14.7.4). The tables hold
 * key material only wrapped by the configured `SqlKeyWrapper`; shredding clears the wrapped bytes
 * and keeps the row with `shredded_at`, and a destroyed value key is deleted, so what it sealed
 * opens to `undefined`. `wrap` and `unwrap` seal other keys under the subject's data key.
 */
export function sqlSubjectKeyStore(ctx: SqlUnitContext): SubjectKeyStore {
  const keys = ctx.table('kw_subject_keys');
  const valueKeys = ctx.table('kw_value_keys');
  const refsTable = ctx.table('kw_subject_refs');
  const wrapper = (): SqlKeyWrapper => {
    if (ctx.keyWrapper === undefined) {
      throw errors.unsupported('the adapter has no key wrapper: configure `keyWrapper`');
    }
    return ctx.keyWrapper;
  };
  const dataKeyOf = async (record: {
    readonly key_id: unknown;
    readonly wrapped: unknown;
  }): Promise<DataKey | undefined> => {
    if (record.wrapped === null || record.wrapped === undefined) return undefined;
    const id = String(record.key_id);
    const material = await wrapper().unwrap(
      ctx.scopeId(),
      decodeBytes(record.wrapped),
      encoder.encode(id),
    );
    return { id, material };
  };
  // The lock the creating path takes; a shred takes it too, so no key is created beside a shred.
  // It is keyed by the canonical subject: the uuid columns read every spelling as one subject.
  const lockSubject = async (subjectId: string): Promise<void> => {
    await sqlGuard(async () => {
      await ctx.db.executeQuery(
        CompiledQuery.raw('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${ctx.scopeId()}:${canonicalSubject(subjectId)}`,
        ]),
      );
    });
  };
  const readValueKey = async (keyId: string) => {
    const record = await sqlGuard(async () =>
      ctx
        .scopedDb()
        .selectFrom(valueKeys)
        .select('wrapped')
        .where('key_id', '=', keyId)
        .executeTakeFirst(),
    );
    if (record === undefined) return undefined;
    const bundle = await wrapper().unwrap(
      ctx.scopeId(),
      decodeBytes(record.wrapped),
      encoder.encode(keyId),
    );
    return { material: bundle.subarray(0, 32), aad: bundle.subarray(32) };
  };
  // A writing unit reads the key `for share`: a shred of the subject waits for the unit to finish,
  // so a value sealed under the key is committed, with its reference, before the shred is (D7).
  const records = async (subjectId: string, lock = false) =>
    sqlGuard(async () => {
      const query = ctx
        .scopedDb()
        .selectFrom(keys)
        .select(['key_id', 'wrapped'])
        .where('subject_id', '=', subjectId)
        .where('purpose', '=', 'data')
        .orderBy('created_at', 'desc')
        .orderBy('key_id', 'desc');
      return (lock && !ctx.readOnly ? query.forShare() : query).execute();
    });
  const dataKey = async (
    subjectId: string,
    options: { readonly create: boolean },
  ): Promise<DataKey | undefined> => {
    let found = await records(subjectId, true);
    if (found.length === 0 && options.create) {
      ctx.writable();
      // Two first uses of one subject must not each create a key: serialise on the subject.
      await lockSubject(subjectId);
      found = await records(subjectId, true);
      if (found.length === 0) {
        const id = newUuidV7();
        const material = crypto.getRandomValues(new Uint8Array(32));
        const wrapped = await wrapper().wrap(ctx.scopeId(), material, encoder.encode(id));
        await sqlGuard(async () => {
          await ctx
            .scopedDb()
            .insertInto(keys)
            .values({
              subject_id: subjectId,
              key_id: id,
              purpose: 'data',
              wrapped: Buffer.from(wrapped),
              kek_version: wrapper().version,
              created_at: encodeInstant(ctx.clock.now()),
            })
            .execute();
        });
        return { id, material };
      }
    }
    const active = found.find((record) => record.wrapped !== null);
    return active === undefined ? undefined : dataKeyOf(active);
  };
  const keyOf = async (subjectId: string | undefined, keyId: string) => {
    let query = ctx
      .scopedDb()
      .selectFrom(keys)
      .select(['key_id', 'wrapped'])
      .where('key_id', '=', keyId)
      .where('purpose', '=', 'data');
    if (subjectId !== undefined) query = query.where('subject_id', '=', subjectId);
    return sqlGuard(async () => query.executeTakeFirst());
  };
  return {
    dataKey,
    keyById: async (keyId) => {
      const record = await keyOf(undefined, keyId);
      return record === undefined ? undefined : dataKeyOf(record);
    },
    shred: async (subjectId) => {
      ctx.writable();
      await lockSubject(subjectId);
      const shredded = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .updateTable(keys)
          .set({ wrapped: null, shredded_at: encodeInstant(ctx.clock.now()) })
          .where('subject_id', '=', subjectId)
          .where('purpose', '=', 'data')
          .where('wrapped', 'is not', null)
          .returning('key_id')
          .execute(),
      );
      return { keyIds: shredded.map((row) => String(row.key_id)).sort() };
    },
    shreddedKeys: async (subjectId) => {
      const rows = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(keys)
          .select(['key_id', 'shredded_at'])
          .where('subject_id', '=', subjectId)
          .where('purpose', '=', 'data')
          .where('wrapped', 'is', null)
          .execute(),
      );
      return rows
        .map((row) => ({
          keyId: String(row.key_id),
          shreddedAt: decodeInstant(row.shredded_at),
        }))
        .sort((a, b) => compareCodePoints(a.keyId, b.keyId));
    },
    addRefs: async (subjectId, streams) => {
      ctx.writable();
      if (streams.length === 0) return;
      await sqlGuard(async () => {
        await ctx
          .scopedDb()
          .insertInto(refsTable)
          .values(
            streams.map((stream) => ({
              subject_id: subjectId,
              stream_type: stream.type,
              stream_id: stream.id,
            })),
          )
          .onConflict((conflict) => conflict.doNothing())
          .execute();
      });
    },
    refs: async (subjectId, after, limit) => {
      let query = ctx
        .scopedDb()
        .selectFrom(refsTable)
        .select(['stream_type', sql<string>`stream_id::text`.as('stream_id')])
        .where('subject_id', '=', subjectId);
      if (after !== null) {
        query = query.where(
          sql<boolean>`(stream_type collate "C" > ${after.type} or (stream_type collate "C" = ${after.type} and stream_id > ${after.id}::uuid))`,
        );
      }
      const rows = await sqlGuard(async () =>
        query
          .orderBy(sql`stream_type collate "C"`, 'asc')
          .orderBy('stream_id', 'asc')
          .limit(limit)
          .execute(),
      );
      return rows.map(
        (row): StreamRef => ({ type: String(row.stream_type), id: String(row.stream_id) }),
      );
    },
    wrap: async (subjectId, key) => {
      ctx.writable();
      const data = await dataKey(subjectId, { create: true });
      if (data === undefined) {
        throw errors.not_found(`the keys of subject ${subjectId} were shredded`);
      }
      const id = encoder.encode(data.id);
      const sealed = await sqlSeal(data.material, key, id);
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
      const record = await keyOf(subjectId, keyId);
      const data = record === undefined ? undefined : await dataKeyOf(record);
      if (data === undefined) return undefined;
      return sqlOpen(
        data.material,
        wrapped.subarray(1 + idLength, 13 + idLength),
        wrapped.subarray(13 + idLength),
        encoder.encode(keyId),
      );
    },
    sealValue: async (binding, plain, options) => {
      ctx.writable();
      const keyId = options?.keyId ?? newUuidV7();
      const stored = options === undefined ? undefined : await readValueKey(keyId);
      if (stored !== undefined) {
        const sealed = await sqlSeal(stored.material, plain, stored.aad);
        return { keyId, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
      }
      const material = crypto.getRandomValues(new Uint8Array(32));
      const aad = encodeAad([binding.entity, binding.id, binding.field]);
      // The associated data is not in the sealed value, so it travels inside the wrapped key.
      const wrapped = await wrapper().wrap(
        ctx.scopeId(),
        new Uint8Array([...material, ...aad]),
        encoder.encode(keyId),
      );
      const inserted = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .insertInto(valueKeys)
          .values({
            key_id: keyId,
            wrapped: Buffer.from(wrapped),
            kek_version: wrapper().version,
            created_at: encodeInstant(ctx.clock.now()),
          })
          .onConflict((conflict) => conflict.doNothing())
          .returning('key_id')
          .executeTakeFirst(),
      );
      if (inserted === undefined) {
        // A unit that committed first created the key of this id: seal under that one.
        const winner = await readValueKey(keyId);
        if (winner === undefined) throw errors.internal(`value key ${keyId} vanished`);
        const sealed = await sqlSeal(winner.material, plain, winner.aad);
        return { keyId, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
      }
      const sealed = await sqlSeal(material, plain, aad);
      return { keyId, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
    },
    liveValueKeys: async (keyIds) => {
      if (keyIds.length === 0) return [];
      const found = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(valueKeys)
          .select('key_id')
          .where('key_id', 'in', keyIds)
          .execute(),
      );
      const live = new Set(found.map((row) => String(row.key_id)));
      return keyIds.filter((keyId) => live.has(keyId));
    },
    openValue: async (sealed, expected) => {
      const stored = await readValueKey(sealed.keyId);
      if (stored === undefined) return undefined;
      if (
        expected !== undefined &&
        !Buffer.from(stored.aad).equals(encodeAad([expected.entity, expected.id, expected.field]))
      ) {
        return undefined;
      }
      return sqlOpen(stored.material, sealed.nonce, sealed.ciphertext, stored.aad);
    },
    valueKeyBinding: async (keyId) => aadBinding((await readValueKey(keyId))?.aad),
    destroyValueKey: async (keyId) => {
      ctx.writable();
      await sqlGuard(async () => {
        await ctx.scopedDb().deleteFrom(valueKeys).where('key_id', '=', keyId).execute();
      });
    },
  };
}
