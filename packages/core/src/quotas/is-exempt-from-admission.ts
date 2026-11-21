import type { ActionEntry } from '../registry/action-entry.ts';

/**
 * Whether the storage limits never refuse the action at its admission (12.2): the actions of the
 * core module, which set the very limits a tenant is brought back under. The admission of a command
 * with `prepare` (`admitPrepare`) asks it; the commit tail's answer is `isExemptFromTail`.
 */
export function isExemptFromAdmission(action: Pick<ActionEntry, 'module'>): boolean {
  return action.module === 'core';
}
