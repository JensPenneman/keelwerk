import {
  errors,
  newUuidV7,
  type Outcome,
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
import { trpcErrorOf } from '../errors/trpc-error-of.ts';
import { superjsonValueOf } from '../transformer/superjson-value-of.ts';
import { superjsonWireOf } from '../transformer/superjson-wire-of.ts';
import type { TrpcContext } from './trpc-context.ts';

/** The invoker's outcome for a raw input: this function never throws, a value thrown on the way is an error of the taxonomy. */
async function outcomeOf(
  context: TrpcContext,
  action: SurfaceAction,
  raw: unknown,
  signal: AbortSignal,
): Promise<Outcome<unknown>> {
  try {
    const wire = context.transformer === 'superjson' ? superjsonWireOf(action.input, raw) : raw;
    const input = decodeActionInput(context.surface, action, wire);
    // The kernel's own form is refused as reserved, before the grammar of a caller's id applies.
    refuseReservedCommandId(context.commandId);
    if (context.commandId !== undefined && !isCommandId(context.commandId)) {
      const message = 'Expected a UUID of version 4 or 7, or a ULID.';
      throw coreError('core.malformed_request', {
        message,
        issues: [{ path: ['headers', 'idempotency-key'], message }],
      });
    }
    const command = action.kind === 'command';
    const commandId = command ? (context.commandId ?? newUuidV7()) : undefined;
    if (commandId !== undefined) context.answer.commandId = commandId;
    return await context.invoker.invoke({
      action: action.ref,
      input,
      carrier: { ...context.carrier, transport: 'trpc' },
      session: context.session,
      requestId: context.requestId,
      ...(commandId === undefined ? {} : { commandId }),
      ...(command && context.prefer !== undefined ? { prefer: context.prefer } : {}),
      ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
      signal: signalOf(action, signal),
    });
  } catch (thrown) {
    return { ok: false, error: asKeelwerkError(thrown) };
  }
}

/** The one encoding of an output: the wire form with `$masked` kept and the cookie hint applied, then, for superjson, revived. */
function encodeOutput(context: TrpcContext, action: SurfaceAction, value: unknown): unknown {
  try {
    const encoded = keepMasked(action.output, value, toWire(action.output, value));
    const hinted = applyCookieHint(
      action.hints.http?.cookie,
      encoded,
      context.session,
      context.carrier.headers ?? {},
      context.now,
    );
    context.answer.setCookies.push(...hinted.setCookies);
    return context.transformer === 'superjson'
      ? superjsonValueOf(action.output, hinted.value)
      : hinted.value;
  } catch (thrown) {
    throw trpcErrorOf(
      errors.internal('The output does not fit its field node.', { cause: thrown }),
    );
  }
}

/**
 * Runs a query or a command as the request's session (section 16.7.1). The raw input is flattened
 * to the wire form when superjson carried it and decoded once, by core, against the surface of the
 * request's API version; a command carries the caller's command id (`Idempotency-Key`) or a
 * generated one. A failed outcome is thrown as the `TRPCError` of its kind, a receipt is answered as
 * `{ commandId, status }`, and any other value is its wire encoding.
 */
export async function invokeProcedure(
  context: TrpcContext,
  action: SurfaceAction,
  raw: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const outcome = await outcomeOf(context, action, raw, signal);
  if (!outcome.ok) throw trpcErrorOf(outcome.error);
  if (outcome.effects !== undefined) context.answer.effects = outcome.effects;
  if (outcome.receipt !== undefined) {
    context.answer.accepted = true;
    return { commandId: outcome.receipt.commandId, status: outcome.receipt.status };
  }
  return encodeOutput(context, action, outcome.value);
}
