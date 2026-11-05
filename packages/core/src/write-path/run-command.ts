import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import { attemptCommand } from './attempt-command.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { refuseGeneratedWrite } from './refuse-generated-write.ts';
import { retryUnit } from './retry-unit.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { runPrepare } from './run-prepare.ts';

/** A generated `set` that names a state: two of them must not both commit on the same token (section 6.7). */
function carriesState(kind: string | undefined, input: unknown): boolean {
  if (kind !== 'set' || typeof input !== 'object' || input === null) return false;
  const state: unknown = Reflect.get(input, 'ifInState');
  return state !== undefined && state !== null;
}

/**
 * Runs a command below the pipeline (section 7.9.4, phases 2 to 7): `prepare` once outside any
 * unit, then the read-write unit of the scope, repeated up to three times on a version conflict,
 * a serialization failure or a deadlock. The unit's first statement inserts the pending receipt; a
 * retry with the same command id and input answers the recorded outcome (`replayed`), another
 * input is `core.idempotency_mismatch`, and a command still running is `core.command_in_progress`.
 * One instant, taken when execution begins, is the clock of every attempt. An abort of
 * `signal` (the action's timeout) rolls the unit back and rejects with its reason.
 */
export async function runCommand(input: RunCommandInput): Promise<CommandResult> {
  const { action } = input;
  if (action.kind !== 'command') {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.request_not_allowed',
      message: `runCommand runs a command; "${action.ref}" is not one`,
      details: { request: action.ref, reason: 'not a command' },
    });
  }
  refuseGeneratedWrite(input);
  if (action.execution === 'async') {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${action.ref}" runs asynchronously, which this release does not do.`,
    });
  }
  input.signal?.throwIfAborted();
  const commandId = input.commandId ?? newUuidV7();
  const now = input.clock.now();
  const clock = { now: () => now };
  const fingerprint = inputFingerprint(action.ref, input.apiVersion, input.input);
  const run: RunCommandInput = { ...input, clock };
  const prepared = action.prepare === undefined ? undefined : await runPrepare(run, input.input);
  return retryUnit(
    () =>
      input.adapter.unit(
        input.namespace,
        input.scope,
        (unit) => attemptCommand({ run, commandId, fingerprint, clock, prepared }, unit),
        {
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(carriesState(action.generated, input.input) ? { isolation: 'serializable' } : {}),
        },
      ),
    {
      ...input.retry,
      retryUnique: true,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
}
