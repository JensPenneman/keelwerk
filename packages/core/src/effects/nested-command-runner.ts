import type { CommandResult } from '../invoker/command-runner.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';

/** What a nested command runs under. */
interface NestedCommand {
  /** The command id: the derived id of the `invoke` effect. */
  readonly commandId: string;
  /** The commands nested including this one. */
  readonly depth: number;
  /** The command that invoked it: the causation of its events. */
  readonly causationId: string;
}

/**
 * Runs a command in a unit that is already open (a savepoint of the invoking command's unit): the
 * write path hands the effects its own `attemptCommand` this way, so the effects never import it.
 */
export type NestedCommandRunner = (
  unit: Unit,
  run: RunCommandInput,
  nested: NestedCommand,
) => Promise<CommandResult>;
