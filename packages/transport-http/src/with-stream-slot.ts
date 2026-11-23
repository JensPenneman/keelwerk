import { unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { takeStreamSlot } from './take-stream-slot.ts';

/**
 * Runs `respond` holding one stream slot of the caller (`takeStreamSlot`, the bounds of 15.4.10): past
 * a bound the answer is `429` (`core.quota_exceeded` or `core.concurrency_limited`) and `respond` is
 * not called. The slot is released once: when the body ends, errors or is cancelled, when the
 * request aborts, when `respond` throws, or at once for a response without a body.
 */
export async function withStreamSlot(
  call: EndpointCall,
  respond: () => Promise<Response>,
): Promise<Response> {
  const { host, state, session, carrier, request } = call;
  let give: () => void;
  try {
    give = await takeStreamSlot(
      host,
      session,
      carrier.connection?.remote.address ?? unknownClientAddress,
    );
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    request.signal.removeEventListener('abort', release);
    give();
  };
  request.signal.addEventListener('abort', release, { once: true });
  let response: Response;
  try {
    response = await respond();
  } catch (failure) {
    release();
    throw failure;
  }
  if (response.body === null) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (failure) {
        release();
        controller.error(failure);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
