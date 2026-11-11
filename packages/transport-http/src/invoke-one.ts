import {
  type ApiSurface,
  type InvokeRequest,
  type InvokeResponse,
  isAppNotServedError,
  type KeelwerkError,
  newUuidV7,
  type Outcome,
} from '@keelwerk/core';
import {
  applyCookieHint,
  asKeelwerkError,
  decodeActionInput,
  keepMasked,
} from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import type { EndpointCall } from './endpoint-call.ts';

/**
 * The surface of the session's app and version, or `undefined` when the process does not serve the
 * app (the invoker then answers for it). Any other failure of the surface, a version the projection
 * cannot derive for one, is not an unknown action: it propagates, so the endpoint answers an
 * internal error and logs it, and no answer leaves without its wire encoding.
 */
function surfaceOf(call: EndpointCall): ApiSurface | undefined {
  const { session, host } = call;
  try {
    return host.deps.surface(session.app, session.apiVersion);
  } catch (failure) {
    if (isAppNotServedError(failure)) return undefined;
    throw failure;
  }
}

/** One invocation's answer: the success envelope with its status, or the error to render. */
export type InvokeResult =
  | { readonly ok: true; readonly status: number; readonly body: InvokeResponse }
  | { readonly ok: false; readonly error: KeelwerkError };

/**
 * Runs one `InvokeRequest` through the invoker with the request's session, and shapes the outcome:
 * the output goes through `toWire` of the action's output node, an accepted asynchronous command
 * answers 202 with the receipt as the value (section 16.4.7), and the `http.cookie` hint applies
 * under S-48.
 */
export async function invokeOne(
  call: EndpointCall,
  item: InvokeRequest,
  single: boolean,
): Promise<InvokeResult> {
  const { host, state, session, carrier, request } = call;
  const surface = surfaceOf(call);
  const action = surface?.actions.find((a) => a.ref === item.action);
  const commandId = item.commandId ?? (action?.kind === 'command' ? newUuidV7() : undefined);
  if (single) {
    state.action = item.action;
    if (action?.deprecated?.at !== undefined) {
      const { at, sunset } = action.deprecated;
      state.deprecatedAction = { at, ...(sunset !== undefined && { sunset }) };
    }
    if (item.commandId === undefined && commandId !== undefined) {
      state.generatedCommandId = commandId;
    }
  }
  const generated = !single && item.commandId === undefined && commandId !== undefined;
  const echoed = generated ? { commandId } : {};
  let outcome: Outcome<unknown>;
  try {
    outcome = await host.deps.invoker.invoke({
      action: item.action,
      input:
        surface === undefined || action === undefined
          ? item.input
          : decodeActionInput(surface, action, item.input),
      carrier,
      session,
      requestId: state.requestId,
      ...(commandId !== undefined && { commandId }),
      ...(item.prefer !== undefined && { prefer: item.prefer }),
      ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
      signal: request.signal,
    });
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
  if (!outcome.ok) {
    return outcome;
  }
  try {
    if (outcome.receipt !== undefined) {
      return {
        ok: true,
        status: 202,
        body: {
          ok: true,
          value: outcome.receipt,
          receipt: outcome.receipt,
          ...(outcome.receiptId !== undefined && { receiptId: outcome.receiptId }),
          ...echoed,
          ...(outcome.effects !== undefined && { effects: outcome.effects }),
        },
      };
    }
    const encoded =
      action === undefined
        ? outcome.value
        : keepMasked(action.output, outcome.value, toWire(action.output, outcome.value));
    const hinted = applyCookieHint(
      action?.hints.http?.cookie,
      encoded,
      session,
      carrier.headers ?? {},
      host.deps.clock?.now(),
    );
    state.setCookies.push(...hinted.setCookies);
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        value: hinted.value,
        ...echoed,
        ...(outcome.effects !== undefined && { effects: outcome.effects }),
      },
    };
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}
