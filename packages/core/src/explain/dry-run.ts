import { errors } from '../errors/errors.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import { attemptCommand } from '../write-path/attempt-command.ts';
import { inputFingerprint } from '../write-path/input-fingerprint.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { runPrepare } from '../write-path/run-prepare.ts';
import { buildDryRunReport } from './build-dry-run-report.ts';
import { dryRunKeys } from './dry-run-keys.ts';
import { dryRunPerform } from './dry-run-perform.ts';
import type { DryRunReport } from './dry-run-report.ts';
import { DryRunRollback } from './dry-run-rollback.ts';
import { DryRunStop } from './dry-run-stop.ts';
import { dryRunValueKeys } from './dry-run-value-keys.ts';
import { recordingUnit } from './recording-unit.ts';
import { redactEffectInput } from './redact-effect-input.ts';

/** What `dryRun` runs with: a command as `runCommand` takes it, and the outcomes given for inline effects. */
export interface DryRunInput extends RunCommandInput {
  /** `--answer <effect>=<json>`: the outcome of an inline effect `prepare` performs, by effect reference. */
  readonly answers?: Readonly<Record<string, unknown>>;
}

/**
 * Runs the write path of a command (section 7.9.6) after the stages the pipeline runs before it
 * (the caller ran admission, validation, translation and authorization): `prepare` once, then the
 * receipt, the load, `decide`, the events and their item checks, the kernel effects and the
 * reactions, all in a unit that always rolls back. Answers the events with before-images, the
 * effects with ids and continuations, the result and the decision record, redacted; an inline
 * effect without an answer stops the run as `would-perform`. The database is untouched.
 */
export async function dryRun(input: DryRunInput): Promise<DryRunReport> {
  const { answers, ...base } = input;
  const { action, registry } = base;
  if (action.kind !== 'command' || action.generated !== undefined || action.execution === 'async') {
    throw errors.validation(
      `"${action.ref}" has no dry run: it is not a synchronous module command.`,
    );
  }
  base.signal?.throwIfAborted();
  const commandId = base.commandId ?? newUuidV7();
  const now = base.clock.now();
  const clock = { now: () => now };
  // New scope keys and value keys stay in memory: the rollback cannot undo a key the key service commits itself.
  const run: RunCommandInput = {
    ...base,
    keys: dryRunKeys(base.keys),
    clock,
    replace: { ...base.replace, perform: dryRunPerform(answers) },
  };
  let prepared: unknown;
  try {
    prepared = action.prepare === undefined ? undefined : await runPrepare(run, base.input);
  } catch (error) {
    if (!(error instanceof DryRunStop)) throw error;
    return {
      status: 'would-perform',
      action: action.ref,
      effect: error.effect,
      input: redactEffectInput(registry.effects.get(error.effect)?.input, error.effectInput),
    };
  }
  const fingerprint = inputFingerprint(action.ref, base.apiVersion, base.input);
  const batches: StreamAppend[] = [];
  const valueKeys = dryRunValueKeys();
  const held: { result?: CommandResult } = {};
  try {
    await base.adapter.unit(
      base.namespace,
      base.scope,
      async (unit) => {
        held.result = await attemptCommand(
          { run, commandId, fingerprint, clock, prepared },
          recordingUnit(
            unit,
            (batch) => {
              batches.push(...batch);
            },
            valueKeys,
          ),
        );
        throw new DryRunRollback();
      },
      base.signal === undefined ? {} : { signal: base.signal },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  const { result } = held;
  if (result === undefined || result.replayed === true) {
    throw errors.conflict(
      'The command id was already used, so the dry run could only replay its recorded outcome.',
    );
  }
  return buildDryRunReport({
    registry,
    action,
    commandId,
    batches,
    output: result.output,
    deferred: result.effects ?? [],
  });
}
