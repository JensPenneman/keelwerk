import { backoffDelay } from './backoff-delay.ts';
import { clientFailure } from './client-failure.ts';
import { readJson } from './read-json.ts';
import type { RetryPolicy } from './retry-policy.ts';

const gatewayStatuses: ReadonlySet<number> = new Set([502, 503, 504]);

function isGatewayFailure(response: Response): boolean {
  return (
    gatewayStatuses.has(response.status) &&
    !(response.headers.get('content-type') ?? '').includes('json')
  );
}

/** The answer of a request: the response and its parsed JSON body (`undefined` when empty or not JSON). */
export interface SentAnswer {
  readonly response: Response;
  readonly body: unknown;
}

/**
 * Sends the request and reads its body, retrying a network failure (a rejected fetch, a body that breaks mid-stream, or a gateway answer that is not
 * the keelwerk envelope) up to `policy.retries` times. The caller builds the request once, so every
 * attempt carries the same body and command id. An aborted request is never retried.
 */
export async function sendWithRetry(
  send: typeof fetch,
  url: string,
  init: RequestInit,
  policy: RetryPolicy,
  signal: AbortSignal | undefined,
): Promise<SentAnswer> {
  let lastFailure: unknown;
  for (let retry = 0; retry <= policy.retries; retry += 1) {
    signal?.throwIfAborted();
    if (retry > 0) {
      await policy.sleep(backoffDelay(policy, retry - 1), signal);
    }
    try {
      const response = await send(url, init);
      if (!isGatewayFailure(response)) {
        return { response, body: await readJson(response) };
      }
      await response.body?.cancel();
      lastFailure = new Error(`the gateway answered ${response.status}`);
    } catch (failure) {
      if (signal?.aborted) {
        throw failure;
      }
      lastFailure = failure;
    }
  }
  throw clientFailure('core.unavailable', 'The server could not be reached.', {
    cause: lastFailure,
  });
}
