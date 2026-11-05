import type { BatchResponse, InvokeResponse } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { invokeOne } from './invoke-one.ts';
import { jsonResponse } from './json-response.ts';
import { parseInvokeRequest } from './parse-invoke-request.ts';
import { parseJsonBody } from './parse-json-body.ts';
import { wireErrorOf } from './wire-error-of.ts';

const maxBatchSize = 20;

/** `POST /_keelwerk/v1/batch`: up to 20 invocations in order, each on its own (section 16.8.2). */
export async function batchEndpoint(call: EndpointCall): Promise<Response> {
  const { host, state } = call;
  try {
    const body = parseJsonBody(call.bytes);
    const list = (body as { readonly invocations?: unknown } | null)?.invocations;
    if (!Array.isArray(list)) {
      throw coreError('core.malformed_request', {
        issues: [{ path: ['invocations'], message: 'Expected a list of invocations.' }],
      });
    }
    if (list.length > maxBatchSize) {
      throw coreError('core.validation', {
        message: `A batch holds at most ${maxBatchSize} invocations.`,
        issues: [{ path: ['invocations'], message: `Got ${list.length}.` }],
      });
    }
    const items = list.map((entry, index) => parseInvokeRequest(entry, ['invocations', index]));
    const results: InvokeResponse[] = [];
    for (const item of items) {
      const result = await invokeOne(call, item, false);
      if (result.ok) {
        results.push(result.body);
      } else {
        host.errorCounter.add(1, {
          transport: state.transport,
          kind: result.error.kind,
          code: result.error.code,
        });
        results.push(wireErrorOf(host, state, result.error));
      }
    }
    const response: BatchResponse = { results };
    return jsonResponse(200, response);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
}
