import type { Decoded } from './decoded.ts';

/** The decoded outcome of a call and the response it came from, for the facts only one transport has. */
export interface Sent {
  readonly decoded: Decoded;
  readonly response: Response;
  /** The response body as parsed JSON, when it had one. */
  readonly body: unknown;
}
