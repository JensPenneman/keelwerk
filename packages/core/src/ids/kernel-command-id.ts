import { kernelCommandIdPrefix } from './kernel-command-id-prefix.ts';

/** The jobs the kernel runs as commands on its own behalf. */
export type KernelCommandKind = 'reaction' | 'continuation' | 'effect' | 'schedule' | 'timer';

/**
 * The command id of a command the kernel makes itself (final): `kernel:<kind>:<part>[:<part>]`, one
 * form for the job of a reaction (reaction id, event id), the continuation of an effect (effect id)
 * and the command an effect runs (effect id), the job of a timer (`kernel:timer:<effect id>`, or a
 * fresh id for a resolver's timer) and the job of a schedule's tick
 * (`kernel:schedule:<schedule>:<scope id>:<period in milliseconds>:<tick in epoch milliseconds>`). Such an id is the idempotency key of that work in the
 * scope's receipt table, so `refuseReservedCommandId` keeps every id a caller chooses out of the
 * form.
 */
export function kernelCommandId(kind: KernelCommandKind, ...parts: readonly string[]): string {
  return `${kernelCommandIdPrefix}${kind}:${parts.join(':')}`;
}
