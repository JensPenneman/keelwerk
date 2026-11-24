import { settleEffects } from '@keelwerk/client';
import {
  type EffectStatusError,
  type ErrorKind,
  type LiveFrame,
  renderTypeId,
} from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { localFailure } from '../context/local-failure.ts';

/** One status as the wire carries it: the id is the TypeID. */
interface WireEffectStatus {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly error?: EffectStatusError;
}

function failureOf(status: WireEffectStatus): CliFailure {
  const message = `Effect ${status.id} ${status.status}.`;
  if (status.error === undefined) return localFailure('internal', 'cli.effect_failed', message);
  return new CliFailure(
    {
      kind: status.error.kind,
      code: status.error.code,
      message,
      retryable: false,
      requestId: 'local',
    },
    message,
  );
}

/** The command committed: whatever the wait comes to, a retry under a new id would be a second command. */
function committedNote(context: CliContext, commandId: string): void {
  context.output.note(
    `note: command ${commandId} committed; its effects are not known to have settled`,
  );
}

/**
 * A failure of the wait after the command committed: never retryable, and its `details` carry the
 * command id, so a wrapper that reads `--output json` waits again and never sends the command a second time.
 */
function committedFailure(
  context: CliContext,
  commandId: string,
  kind: ErrorKind,
  code: string,
  message: string,
): CliFailure {
  committedNote(context, commandId);
  return new CliFailure(
    {
      kind,
      code,
      message,
      retryable: false,
      requestId: 'local',
      details: { committed: true, commandId },
    },
    message,
  );
}

/**
 * `--wait-effects[=<seconds>]` (16.4.7, 16.9.4): waits on `core.effectStatusWatch` until every effect
 * the command requested has settled, one note per status on standard error (`effect <id> <type>
 * <status>`; standard output stays the command's value). An effect the watch does not know is exit 6
 * `cli.effect_not_found`; past the limit the notes are followed by exit 10 `cli.wait_timeout`; a
 * `failed` or `abandoned` effect ends the command with its own error kind and code, or `cli.effect_failed`
 * when it has none. Any other failure of the wait, the watch's own error included, is `cli.wait_failed`
 * (10), never the server's code. Each of those three says on standard error that the command committed
 * under `commandId` and is not retryable; its `details` are `{ committed: true, commandId }`, so a
 * wrapper waits again and does not send the command a second time.
 */
export async function waitEffects(
  context: CliContext,
  effects: readonly string[],
  seconds: number | null,
  commandId: string,
): Promise<void> {
  if (effects.length === 0) return;
  const ids = effects.map((id) => renderTypeId('eff', id));
  let settling: Awaited<ReturnType<typeof settleEffects<WireEffectStatus>>>;
  try {
    settling = await settleEffects<WireEffectStatus>(
      (chunk) =>
        context.client.subscribe(
          'core.effectStatusWatch',
          { ids: chunk },
          { signal: context.signal },
        ) as AsyncIterable<LiveFrame<WireEffectStatus>>,
      ids,
      {
        ...(seconds !== null && { timeoutMs: seconds * 1000 }),
        signal: context.signal,
      },
    );
  } catch (failure) {
    if (context.signal.aborted) throw failure;
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw committedFailure(
      context,
      commandId,
      'unavailable',
      'cli.wait_failed',
      `The wait for the effects failed: ${reason}`,
    );
  }
  for (const status of settling.statuses) {
    context.output.note(`effect ${status.id} ${status.type} ${status.status}`);
  }
  if (settling.missing.length > 0) {
    throw committedFailure(
      context,
      commandId,
      'not_found',
      'cli.effect_not_found',
      `${settling.missing.length} of the effects are not known to this caller.`,
    );
  }
  if (!settling.settled) {
    throw committedFailure(
      context,
      commandId,
      'unavailable',
      'cli.wait_timeout',
      'The effects did not settle within the time given to --wait-effects.',
    );
  }
  const failed = settling.statuses.find(
    (status) => status.status === 'failed' || status.status === 'abandoned',
  );
  if (failed !== undefined) throw failureOf(failed);
}
