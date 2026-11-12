import type { StorageScope } from '@keelwerk/core';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

/** A key that can still open something: its material and where it comes from. */
interface KeyLeft {
  readonly label: string;
  readonly material: Uint8Array;
}

/** The `info` of every key the kernel derives from a scope key; the scope keys themselves never leave the key service. */
const derivations = [
  'keelwerk/index-root/1',
  'keelwerk/fingerprint/v1',
  'keelwerk/bucket/1',
  'keelwerk/state-token/v2',
  'keelwerk/key-wrap/1',
] as const;

/**
 * Every key that exists now and could seal or open a value of the dump: the data key of every
 * subject whose material is not shredded (read through the key store of the tenant's and the
 * backend's scope, by the ids `kw_subject_keys` lists), and the keys derived from the tenant's,
 * the backend's and the deployment's scope key. Value keys open through `unit.keys.openValue`.
 */
async function keysLeft(
  runtime: Runtime,
  queries: readonly DumpQuery[],
  tenantScope: StorageScope,
): Promise<readonly KeyLeft[]> {
  const ids = new Set<string>();
  for (const query of queries) {
    const tables = await query(
      `select schemaname from pg_tables where tablename = 'kw_subject_keys'`,
    );
    for (const { schemaname } of tables) {
      for (const row of await query(
        `select key_id::text as id from "${String(schemaname)}"."kw_subject_keys" where wrapped is not null`,
      )) {
        ids.add(String(row.id));
      }
    }
  }
  const scopes: readonly StorageScope[] = [
    tenantScope,
    { level: 'backend', backendId: runtime.backendId },
  ];
  const left: KeyLeft[] = [];
  for (const id of ids) {
    for (const scope of scopes) {
      const key = await runtime.sealed
        .unit(runtime.namespace, scope, (unit) => unit.keys.keyById(id), { readOnly: true })
        .catch(() => undefined);
      if (key !== undefined) {
        left.push({ label: `data key ${id} of the ${scope.level} scope`, material: key.material });
        break;
      }
    }
  }
  const derivedScopes: readonly StorageScope[] = [...scopes, { level: 'deployment' }];
  for (const scope of derivedScopes) {
    for (const info of derivations) {
      const material = await runtime.keys.derive(scope, info, 32).catch(() => undefined);
      if (material !== undefined)
        left.push({ label: `${info} of the ${scope.level} scope`, material });
    }
  }
  return left;
}

export type { KeyLeft };
export { keysLeft };
