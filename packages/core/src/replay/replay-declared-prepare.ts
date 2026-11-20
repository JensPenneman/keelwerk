import type { DecisionRecord } from '../events/decision-record.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { AsOfContext } from './as-of-context.ts';
import { type ReplayedPrepare, replayPrepare } from './replay-prepare.ts';
import { replayUnsupported } from './replay-unsupported.ts';

/**
 * The prepare of a re-decide (D3): replayed from the record when this build declares one, so its
 * value is what decide sees as `ctx.prepared`. A record without a prepare record, written before
 * prepare was recorded, is refused; a record that ran a prepare this build no longer has is a
 * difference, and decide goes on without a prepared value.
 */
export async function replayDeclaredPrepare(input: {
  /** The re-decide's run with the real adapter. */
  readonly run: RunCommandInput;
  readonly unit: Unit;
  readonly context: Omit<AsOfContext, 'reads'>;
  readonly record: DecisionRecord;
  readonly commandId: string;
  readonly input: unknown;
  readonly personalByPresence?: true;
}): Promise<{ readonly prepared?: ReplayedPrepare; readonly difference?: string }> {
  const { run, record } = input;
  if (run.action.prepare === undefined) {
    return record.prepare === undefined
      ? {}
      : { difference: 'the recorded decision ran prepare; this build has none' };
  }
  if (record.prepare === undefined) {
    throw replayUnsupported(
      'the record holds no prepare record (written before prepare was recorded)',
    );
  }
  return {
    prepared: await replayPrepare({
      run,
      unit: input.unit,
      context: input.context,
      record: record.prepare,
      commandId: input.commandId,
      input: input.input,
      ...(input.personalByPresence === true ? { personalByPresence: true } : {}),
    }),
  };
}
