import { asKeelwerkError } from './as-keelwerk-error.ts';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { invokeOne } from './invoke-one.ts';
import { jsonResponse } from './json-response.ts';
import { parseInvokeRequest } from './parse-invoke-request.ts';
import { parseJsonBody } from './parse-json-body.ts';

/** `POST /_keelwerk/v1/invoke`: one query or command (section 16.8.2). */
export async function invokeEndpoint(call: EndpointCall): Promise<Response> {
  const { host, state } = call;
  try {
    const item = parseInvokeRequest(parseJsonBody(call.bytes), []);
    const result = await invokeOne(call, item, true);
    if (!result.ok) {
      return errorResponse(host, state, result.error);
    }
    const headers = new Headers();
    if (state.generatedCommandId !== undefined) {
      headers.set('keelwerk-command-id', state.generatedCommandId);
    }
    if (result.status === 202) {
      headers.set('preference-applied', 'respond-async');
    }
    return jsonResponse(result.status, result.body, headers);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
}
