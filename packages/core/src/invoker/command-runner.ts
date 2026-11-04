import type { ActionEntry } from '../registry/action-entry.ts';
import type { CommandReceipt } from './command-receipt.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { ScopeTarget } from './scope-target.ts';

/** What the execute stage hands the command write path (the seam WP-38 fills). */
export interface CommandRun {
  readonly action: ActionEntry;
  /** The validated input. */
  readonly input: unknown;
  readonly invocation: Invocation<unknown>;
  readonly session: InvocationSession;
  /** The unit's scope, namespace and placement. */
  readonly target: ScopeTarget;
  /** Aborts on the action's timeout only: a client disconnect never reaches a command (section 16.4.11). */
  readonly signal: AbortSignal;
}

/** What a command answered. */
export interface CommandResult {
  readonly output: unknown;
  readonly receipt?: CommandReceipt;
  /** Ids of the deferred effects (section 7.9.5). */
  readonly effects?: readonly string[];
  readonly replayed?: true;
}

/** Runs one command below the pipeline; an error is thrown and the invoker maps it. */
export type CommandRunner = (run: CommandRun) => Promise<CommandResult>;
