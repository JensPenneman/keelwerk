import type { ActionEntry } from '../registry/action-entry.ts';

/**
 * Whether the unit opened for a command declares no storage limit at its commit tail (12.2): the
 * command declares a `prepare` step. Asked once, by `attemptCommand`, for the command the unit was
 * opened for, and handed on to what runs in the unit (`isExemptFromTail`): a synchronous command
 * invoked in the unit does not ask it again of its own action.
 */
export function isUnitExemptFromTail(command: Pick<ActionEntry, 'prepare'>): boolean {
  return command.prepare !== undefined;
}
