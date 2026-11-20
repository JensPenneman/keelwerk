import {
  errors,
  type KeelwerkError,
  newUuidV7,
  refuseReservedCommandId,
  type SurfaceAction,
} from '@keelwerk/core';
import {
  applyCookieHint,
  asKeelwerkError,
  coreError,
  decodeActionInput,
  isCommandId,
  keepMasked,
  signalOf,
} from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import { orpcErrorOf } from '../errors/orpc-error-of.ts';
import { nativeOfWire } from '../wire/native-of-wire.ts';
import { wireOfNative } from '../wire/wire-of-native.ts';
import type { OrpcContext } from './orpc-context.ts';

/** The caller's command id: the `Idempotency-Key`, a UUID of version 4 or 7 or a ULID, never in the kernel's reserved form. */
function commandIdOf(context: OrpcContext): string | undefined {
  const value = context.carrier.headers?.['idempotency-key']?.trim();
  if (value === undefined) return undefined;
  refuseReservedCommandId(value);
  if (!isCommandId(value)) {
    throw coreError('core.malformed_request', {
      message: 'Idempotency-Key: Expected a UUID of version 4 or 7, or a ULID.',
    });
  }
  return value;
}

/** Whether `Prefer` names `respond-async` (RFC 7240); other preferences are ignored. */
function prefersAsync(context: OrpcContext): boolean {
  const header = context.carrier.headers?.prefer ?? '';
  return header
    .split(',')
    .some((part) => (part.split(/[=;]/)[0] ?? '').trim().toLowerCase() === 'respond-async');
}

/**
 * The output as the wire shows it, then in the serialiser's own types: what a client reads. The
 * cookies of the hint are kept only once the whole value is built, so an output that does not fit
 * leaves no `Set-Cookie` behind.
 */
function outputOf(context: OrpcContext, action: SurfaceAction, value: unknown): unknown {
  try {
    const encoded = keepMasked(action.output, value, toWire(action.output, value));
    const hinted = applyCookieHint(
      action.hints.http?.cookie,
      encoded,
      context.session,
      context.carrier.headers ?? {},
      context.now,
    );
    const native =
      context.wire === 'orpc' ? nativeOfWire(action.output, hinted.value) : hinted.value;
    context.setCookies.push(...hinted.setCookies);
    return native;
  } catch (thrown) {
    throw errors.internal('The output does not fit its field node.', { cause: thrown });
  }
}

/** Invokes the action; a failure is the thrown taxonomy error, which the caller turns into an oRPC error. */
async function run(context: OrpcContext, action: SurfaceAction, wire: unknown): Promise<unknown> {
  const input = decodeActionInput(
    context.surface,
    action,
    action.input.kind === 'void' ? undefined : wireOfNative(wire),
  );
  const isCommand = action.kind === 'command';
  const commandId = isCommand ? (commandIdOf(context) ?? newUuidV7()) : undefined;
  const outcome = await context.invoker.invoke({
    action: action.ref,
    input,
    carrier: { ...context.carrier, transport: 'orpc' },
    session: context.session,
    requestId: context.requestId,
    ...(commandId === undefined ? {} : { commandId }),
    ...(isCommand && prefersAsync(context) ? { prefer: 'async' as const } : {}),
    ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
    signal: signalOf(action, context.signal),
  });
  if (!outcome.ok) throw outcome.error;
  const value =
    outcome.receipt === undefined ? outputOf(context, action, outcome.value) : undefined;
  if (action.deprecated !== undefined) context.answer.deprecated = action.deprecated;
  if (commandId !== undefined) context.answer.commandId = commandId;
  if (outcome.replayed === true) context.answer.replayed = true;
  if (outcome.effects !== undefined && outcome.effects.length > 0) {
    context.answer.effects = outcome.effects;
  }
  if (outcome.receipt !== undefined) {
    context.answer.accepted = true;
    if (isCommand && prefersAsync(context)) context.answer.preferred = true;
    return outcome.receipt;
  }
  return value;
}

/**
 * Runs a query or a command as the request's session (section 16.7.7). The wire input is decoded
 * once, by core, after the serialiser's own types are put in their wire form; a command carries
 * the `Idempotency-Key` header or a generated id and honours `Prefer: respond-async`. The output
 * is the wire encoding with the cookie hint applied, in the serialiser's types for 'orpc'. What
 * the response needs besides the value goes to `context.answer`, and only for a call that
 * succeeded, as REST does: the command id, the replay mark, the effects and the deprecation of the
 * action. A failure of any kind is thrown as the oRPC error of the taxonomy error.
 */
export async function invokeProcedure(
  context: OrpcContext,
  action: SurfaceAction,
  wire: unknown,
): Promise<unknown> {
  context.answer.entered = true;
  try {
    return await run(context, action, wire);
  } catch (thrown) {
    const error: KeelwerkError = asKeelwerkError(thrown);
    throw orpcErrorOf(error, context);
  }
}
