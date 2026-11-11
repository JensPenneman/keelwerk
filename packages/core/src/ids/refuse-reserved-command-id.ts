import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { isKernelCommandId } from './is-kernel-command-id.ts';

/**
 * Refuses, with `validation` `core.command_id_reserved`, a command id that a caller chose (a
 * client, an `enqueue` effect) in the form the kernel reserves for its own commands. Without it a
 * caller who knows an event or effect id could claim the receipt of a reaction job or of an
 * effect's continuation before the kernel does, and the kernel's work would meet
 * `core.idempotency_mismatch` for good. Undefined passes.
 */
export function refuseReservedCommandId(commandId: string | undefined): void {
  if (commandId === undefined || !isKernelCommandId(commandId)) return;
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.command_id_reserved',
    message: 'A command id may not start with "kernel:": that form is reserved for the kernel.',
    issues: [{ path: ['commandId'], message: 'starts with the reserved prefix "kernel:"' }],
  });
}
