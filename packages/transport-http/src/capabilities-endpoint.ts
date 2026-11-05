import { asKeelwerkError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { invokeOne } from './invoke-one.ts';
import { jsonResponse } from './json-response.ts';

/** `GET /_keelwerk/v1/capabilities`: the public answer of `core.capabilities` (sections 16.8.2 and 18.7). */
export async function capabilitiesEndpoint(call: EndpointCall): Promise<Response> {
  const { host, state } = call;
  try {
    const result = await invokeOne(call, { action: 'core.capabilities' }, true);
    if (!result.ok) {
      return errorResponse(host, state, result.error);
    }
    return jsonResponse(200, result.body.ok ? result.body.value : null);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
}
