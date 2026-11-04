import { camelFromKebab } from '@keelwerk/core';
import type { ImportEntry } from './import-entry.ts';

/** The import of another module's value from its package (`import { accounts } from '@scope/module-accounts'`). */
export function moduleImport(scope: string, id: string): ImportEntry {
  return { from: `${scope}/module-${id}`, names: [camelFromKebab(id)] };
}
