import { ClientError } from './client-error.ts';
import { clientFailure } from './client-failure.ts';
import { decodeWithSurface } from './decode-with-surface.ts';
import type { EffectReferences } from './effect-references.ts';
import { encodeActionInput } from './encode-action-input.ts';
import { errorOfEnvelope } from './error-of-envelope.ts';
import type { InvocationResult } from './invocation-result.ts';
import type { InvokeOptions } from './invoke-options.ts';
import { isRecord } from './is-record.ts';
import { liveUnavailable } from './live-unavailable.ts';
import { newCommandId } from './new-command-id.ts';
import type { Prefer } from './prefer.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { requestHeaders } from './request-headers.ts';
import { sendWithRetry } from './send-with-retry.ts';
import { settleRemoteEffects } from './settle-remote-effects.ts';

type Invoked = {
  readonly value: unknown;
  readonly commandId?: string;
  readonly effects?: EffectReferences;
};

/** Failures of a wait that came after the command committed, with what the call reported by then. */
const committed = new WeakMap<ClientError, Reported>();

type Reported = { readonly commandId?: string; readonly effects?: EffectReferences };

/**
 * The error of a wait that failed after the command committed: the same kind and code, but never
 * retryable, because a retry sends the command again. It names the command id and the effects, so the
 * caller waits again with `waitForEffects` instead. `core.timeout` means rolled back and safe to send
 * again (16.4.11), which a committed command never is: a wait that ends with it is reported as
 * `client.effects_unsettled`, the original as its cause.
 */
function committedFailure(failure: ClientError, reported: Reported): ClientError {
  const named = reported.commandId === undefined ? '' : ` (command id ${reported.commandId})`;
  const unsettled = failure.code === 'core.timeout';
  const error = new ClientError({
    kind: unsettled ? 'unavailable' : failure.kind,
    code: unsettled ? 'client.effects_unsettled' : failure.code,
    message: `The command committed${named} but waiting for its effects failed: ${failure.message} Send it again only under that command id, or wait for its effects with waitForEffects.`,
    retryable: false,
    details: { committed: true, ...reported },
    cause: failure,
    ...(failure.issues !== undefined && { issues: failure.issues }),
    ...(failure.requestId !== undefined && { requestId: failure.requestId }),
  });
  committed.set(error, reported);
  return error;
}

async function invoke(
  state: RemoteClientState,
  ref: string,
  input: unknown,
  options: InvokeOptions<Prefer>,
): Promise<Invoked> {
  const loaded = await state.surfaces.get();
  const waiting = options.waitEffects !== undefined && options.waitEffects !== false;
  // A surface without the live module has nothing to wait on: refuse before sending, as the command
  // would commit and its caller could not wait for it (16.4.7).
  if (waiting && !loaded.surface.modules.some((candidate) => candidate.id === 'live')) {
    throw liveUnavailable('Waiting for effects');
  }
  const action = loaded.actions.get(ref);
  if (action === undefined) {
    throw clientFailure('core.not_found', `The surface has no action ${ref}.`);
  }
  const wireInput = encodeActionInput(loaded.surface, action, input);
  // One command id per call: every retry of the request below carries the same body.
  const commandId = options.commandId ?? (action.kind === 'command' ? newCommandId() : undefined);
  const body = JSON.stringify({
    action: ref,
    ...(wireInput !== undefined && { input: wireInput }),
    ...(commandId !== undefined && { commandId }),
    ...(options.prefer !== undefined && { prefer: options.prefer }),
  });
  const { response, body: answer } = await sendWithRetry(
    state.send,
    `${state.origin}/_keelwerk/v1/invoke`,
    {
      method: 'POST',
      headers: requestHeaders(state, true),
      body,
      ...(options.signal !== undefined && { signal: options.signal }),
    },
    state.retry,
    options.signal,
  );
  if (!isRecord(answer) || answer.ok !== true) {
    throw errorOfEnvelope(answer, response.status, loaded);
  }
  const effects = Array.isArray(answer.effects) ? (answer.effects as EffectReferences) : undefined;
  const reported = {
    ...(commandId !== undefined && { commandId }),
    ...(effects !== undefined && { effects }),
  };
  const value =
    answer.receipt !== undefined
      ? answer.receipt
      : decodeWithSurface(action.output, answer.value, `the output of ${ref}`);
  // The command has committed: a failure of the wait (not an abort) never takes its outcome away. The
  // failure is the call's error, marked as not retryable and carrying the command id and the effects.
  // A wait that ended before every effect settled (the timeout, or a watch that closed) is one too:
  // the call resolves only when the effects settled.
  if (waiting && effects !== undefined) {
    try {
      const settling = await settleRemoteEffects(state, effects, {
        ...(typeof options.waitEffects === 'object' && {
          timeoutMs: options.waitEffects.timeoutMs,
        }),
        ...(options.signal !== undefined && { signal: options.signal }),
      });
      if (!settling.settled) {
        throw clientFailure(
          'client.effects_unsettled',
          'The effects had not settled when the wait ended (timeoutMs reached or the watch closed).',
        );
      }
    } catch (failure) {
      throw failure instanceof ClientError ? committedFailure(failure, reported) : failure;
    }
  }
  return { value, ...reported };
}

/** Runs one invocation; a failure of the taxonomy is the result, anything else (an abort) is thrown. */
export async function runInvocation(
  state: RemoteClientState,
  ref: string,
  input: unknown,
  options: InvokeOptions<Prefer>,
): Promise<InvocationResult> {
  try {
    return { ok: true, ...(await invoke(state, ref, input, options)) };
  } catch (failure) {
    if (failure instanceof ClientError) {
      return { ok: false, error: failure, ...committed.get(failure) };
    }
    throw failure;
  }
}
