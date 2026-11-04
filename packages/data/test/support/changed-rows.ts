import type { StorageScope } from '@keelwerk/core';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { inUnit } from './in-unit.ts';
import { runStatement } from './run-statement.ts';

/** Rows a statement changed; a statement the role has no privilege for changed none. */
export async function changedRows(
  adapter: PgliteAdapter,
  scope: StorageScope,
  text: string,
  values: unknown[],
): Promise<number> {
  try {
    return await inUnit(adapter, scope, async (u) => (await runStatement(u, text, values)).changed);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '42501') return 0;
    throw error;
  }
}
