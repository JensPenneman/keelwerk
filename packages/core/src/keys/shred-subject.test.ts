import { describe, expect, test } from 'vitest';
import { createSealingContext } from '../encryption/create-sealing-context.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';
import { decoySubject } from './decoy-subject.ts';
import { shredSubject } from './shred-subject.ts';

const scope: StorageScope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const at = Temporal.Instant.from('2026-11-11T10:00:00Z');

/** A subject key store that keeps what the shred needs: live keys, shredded ones and a creation count. */
function fakeUnit() {
  const live = new Map<string, DataKey[]>();
  const shredded = new Set<string>();
  const destroyed = new Map<string, string[]>();
  const state = { created: 0 };
  const keys = {
    dataKey: async (subjectId: string, options: { create: boolean }) => {
      const found = live.get(subjectId)?.at(-1);
      if (found !== undefined) return found;
      if (shredded.has(subjectId) || !options.create) return undefined;
      state.created += 1;
      const key = { id: `key-${state.created}`, material: new Uint8Array(32) };
      live.set(subjectId, [key]);
      return key;
    },
    keyById: async () => undefined,
    shred: async (subjectId: string) => {
      const doomed = live.get(subjectId) ?? [];
      live.delete(subjectId);
      shredded.add(subjectId);
      destroyed.set(subjectId, [
        ...(destroyed.get(subjectId) ?? []),
        ...doomed.map((key) => key.id),
      ]);
      return { keyIds: doomed.map((key) => key.id).sort() };
    },
    shreddedKeys: async (subjectId: string) =>
      (destroyed.get(subjectId) ?? []).sort().map((keyId) => ({ keyId, shreddedAt: at })),
  };
  const unit = { scope, keys } as unknown as Unit;
  return { unit, state, live, keys };
}

function fakeKeyService() {
  const invalidated: StorageScope[] = [];
  const service = {
    invalidate: (invalidatedScope: StorageScope) => {
      invalidated.push(invalidatedScope);
    },
  } as unknown as KeyService;
  return { service, invalidated };
}

describe('shredSubject', () => {
  test('answers one tombstone per destroyed key, and the same ones on the second call', async () => {
    const { unit, live } = fakeUnit();
    live.set('s1', [
      { id: 'k2', material: new Uint8Array(32) },
      { id: 'k1', material: new Uint8Array(32) },
    ]);
    const { service, invalidated } = fakeKeyService();
    const first = await shredSubject(unit, service, 's1', at);
    expect(first).toEqual([
      {
        type: 'keyTombstone',
        scopeId: 't1',
        keyId: 'k1',
        recordedAt: '2026-11-11T10:00:00Z',
        reason: 'erasure',
      },
      {
        type: 'keyTombstone',
        scopeId: 't1',
        keyId: 'k2',
        recordedAt: '2026-11-11T10:00:00Z',
        reason: 'erasure',
      },
    ]);
    expect(invalidated).toEqual([scope]);
    expect(await shredSubject(unit, service, 's1', at)).toEqual(first);
  });

  test('a subject with no key answers nothing', async () => {
    const { unit } = fakeUnit();
    expect(await shredSubject(unit, fakeKeyService().service, 'nobody', at)).toEqual([]);
  });

  test('a seal after the shred is forbidden and creates no key', async () => {
    const { unit, state } = fakeUnit();
    const context = createSealingContext(unit, {
      describe: () => undefined,
      keys: fakeKeyService().service,
      maxScan: 1000,
    } as never);
    await context.dataKey('s1');
    expect(state.created).toBe(1);
    await shredSubject(unit, fakeKeyService().service, 's1', at);
    const later = createSealingContext(unit, {
      describe: () => undefined,
      keys: fakeKeyService().service,
      maxScan: 1000,
    } as never);
    await expect(later.dataKey('s1')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(state.created).toBe(1);
  });

  test('a unit that is not a tenant unit is refused', async () => {
    const { keys } = fakeUnit();
    const unit = { scope: { level: 'deployment' }, keys } as unknown as Unit;
    await expect(shredSubject(unit, fakeKeyService().service, 's1', at)).rejects.toMatchObject({
      kind: 'internal',
    });
  });

  test('the reserved decoy subject is refused in either spelling, and its key stays', async () => {
    const { unit, live, keys } = fakeUnit();
    live.set(decoySubject, [{ id: 'decoy-key', material: new Uint8Array(32) }]);
    for (const spelling of [
      decoySubject,
      decoySubject.replaceAll('-', ''),
      decoySubject.toUpperCase(),
    ]) {
      await expect(
        shredSubject(unit, fakeKeyService().service, spelling, at),
      ).rejects.toMatchObject({
        kind: 'internal',
      });
    }
    expect((await keys.dataKey(decoySubject, { create: false }))?.id).toBe('decoy-key');
    expect(await keys.shreddedKeys(decoySubject)).toEqual([]);
  });
});
