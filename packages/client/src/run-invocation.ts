import { ClientError } from './client-error.ts';
import { clientFailure } from './client-failure.ts';
import { decodeWithSurface } from './decode-with-surface.ts';
import type { EffectReferences } from './effect-references.ts';
import { encodeWithSurface } from './encode-with-surface.ts';
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

type Invoked = {
  readonly value: unknown;
  readonly commandId?: string;
  readonly effects?: EffectReferences;
};

async function invoke(
  state: RemoteClientState,
  ref: string,
  input: unknown,
  options: InvokeOptions<Prefer>,
): Promise<Invoked> {
  if (options.waitEffects) {
    // Nothing is sent: the command would commit and the caller would lose its outcome (16.4.7).
    throw liveUnavailable('Waiting for effects');
  }
  const loaded = await state.surfaces.get();
  const action = loaded.actions.get(ref);
  if (action === undefined) {
    throw clientFailure('core.not_found', `The surface has no action ${ref}.`);
  }
  const wireInput = encodeWithSurface(action.input, input, ref);
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
  if (answer.receipt !== undefined) {
    return { value: answer.receipt, ...reported };
  }
  return {
    value: decodeWithSurface(action.output, answer.value, `the output of ${ref}`),
    ...reported,
  };
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
      return { ok: false, error: failure };
    }
    throw failure;
  }
}
