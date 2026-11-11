import {
  newUuidV7,
  type Outcome,
  refuseReservedCommandId,
  type SurfaceAction,
} from '@keelwerk/core';
import {
  asKeelwerkError,
  coreError,
  decodeActionInput,
  isCommandId,
  signalOf,
} from '@keelwerk/core/http';
import type { GraphqlContext } from './graphql-context.ts';

/**
 * Invokes an action as the request's session: the wire input is decoded once, by core, against the
 * surface of the request's API version (public ids, bounds and bare-UUID refusal included), a
 * command carries the caller's command id (1 to 255 visible ASCII characters, never in the
 * kernel's reserved form) or a generated one, and a value thrown on the way is an
 * error of the taxonomy. The result is the invoker's outcome: this function never throws.
 */
export async function invokeAction(
  context: GraphqlContext,
  action: SurfaceAction,
  wire: unknown,
  command: { readonly commandId?: string; readonly prefer?: 'sync' | 'async' } = {},
): Promise<Outcome<unknown>> {
  try {
    const input = decodeActionInput(context.surface, action, wire);
    if (command.commandId !== undefined && !isCommandId(command.commandId)) {
      const message = 'The command id must be 1 to 255 visible ASCII characters.';
      throw coreError('core.malformed_request', {
        message,
        issues: [{ path: ['input', 'commandId'], message }],
      });
    }
    refuseReservedCommandId(command.commandId);
    const commandId = action.kind === 'command' ? (command.commandId ?? newUuidV7()) : undefined;
    return await context.invoker.invoke({
      action: action.ref,
      input,
      carrier: { ...context.carrier, transport: 'graphql' },
      session: context.session,
      requestId: context.requestId,
      ...(commandId === undefined ? {} : { commandId }),
      ...(command.prefer === undefined ? {} : { prefer: command.prefer }),
      ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
      signal: signalOf(action, context.signal),
    });
  } catch (thrown) {
    return { ok: false, error: asKeelwerkError(thrown) };
  }
}
