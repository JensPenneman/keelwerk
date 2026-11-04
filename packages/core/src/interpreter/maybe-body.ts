import type { MaybeRequest } from '../protocol/maybe-request.ts';

/**
 * A Maybe request whose function returned a generator (or plain value) rather than a request: it is
 * kept beside the request and driven by its answerer, since `MaybeRequest.inner` holds requests.
 */
export interface MaybeBody extends MaybeRequest {
  readonly body?: unknown;
}
