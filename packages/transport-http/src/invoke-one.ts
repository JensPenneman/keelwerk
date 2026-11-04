import {
  type InvokeRequest,
  type InvokeResponse,
  type KeelwerkError,
  newUuidV7,
  type Outcome,
  type SurfaceAction,
} from '@keelwerk/core';
import { toWire } from '@keelwerk/core/wire';
import { applyCookieHint } from './apply-cookie-hint.ts';
import { asKeelwerkError } from './as-keelwerk-error.ts';
import type { EndpointCall } from './endpoint-call.ts';

function actionOf(call: EndpointCall, ref: string): SurfaceAction | undefined {
  try {
    const { session, host } = call;
    return host.deps.surface(session.app, session.apiVersion).actions.find((a) => a.ref === ref);
  } catch {
    return undefined;
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
  const action = actionOf(call, item.action);
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
      input: item.input,
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
          ...echoed,
          ...(outcome.effects !== undefined && { effects: outcome.effects }),
        },
      };
    }
    const encoded = action === undefined ? outcome.value : toWire(action.output, outcome.value);
    const hinted = applyCookieHint(
      action?.hints.http?.cookie,
      encoded,
      session,
      carrier.headers ?? {},
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
