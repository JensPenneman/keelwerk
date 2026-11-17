/**
 * Ties the work of a request to its answer: a plain answer aborts `controller` at once, an event
 * stream aborts it when its body ends, fails or is cancelled. So no iterator of a subscription
 * outlives the response that carried it.
 */
export function endWithResponse(response: Response, controller: AbortController): Response {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('text/event-stream') || response.body === null) {
    controller.abort();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(sink) {
      try {
        const step = await reader.read();
        if (step.done) {
          controller.abort();
          sink.close();
        } else {
          sink.enqueue(step.value);
        }
      } catch (thrown) {
        controller.abort();
        sink.error(thrown);
      }
    },
    async cancel(reason) {
      controller.abort();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
