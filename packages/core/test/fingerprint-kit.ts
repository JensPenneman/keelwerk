import { deriveHkdf } from '../src/keys/derive-hkdf.ts';
import type { DataKey } from '../src/storage/data-key.ts';
import type { Unit } from '../src/storage/unit.ts';

/** A key service that derives from one fixed key and tells the last derivation. */
export const derived: { info?: string; length?: number } = {};
export const fingerprintKeys = {
  derive: async (_scope: unknown, info: string, length: number) => {
    derived.info = info;
    derived.length = length;
    return deriveHkdf(new Uint8Array(32).fill(7), '', info, length);
  },
};
export const subjectAda = '0198a1e0-0000-7000-8000-00000000a001';
export const subjectBea = '0198a1e0-0000-7000-8000-00000000a002';
export const fingerprintScope = {
  level: 'tenant',
  backendId: 'backend-1',
  tenantId: 'tenant-1',
} as const;

/** A tenant unit whose subjects hold the keys of `keyed`, material fixed per subject. */
export function fingerprintTenantUnit(
  keyed: readonly string[],
  level: 'tenant' | 'backend' = 'tenant',
): Unit {
  const keys = new Map<string, DataKey>(
    keyed.map((id, index) => [
      id,
      { id: `key-${index}`, material: new Uint8Array(32).fill(index + 1) },
    ]),
  );
  return {
    namespace: { id: 'namespace-1' },
    scope: level === 'tenant' ? fingerprintScope : { level: 'backend', backendId: 'backend-1' },
    keys: { dataKey: (id: string) => Promise.resolve(keys.get(id)) },
    rows: { findOne: () => Promise.resolve(undefined) },
  } as unknown as Unit;
}
