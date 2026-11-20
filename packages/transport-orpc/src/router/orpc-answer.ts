import type { KeelwerkError, SurfaceAction } from '@keelwerk/core';

/**
 * What a procedure tells the handler about the response of its request (one call per request,
 * there is no batching): the handler turns it into headers and the status after oRPC has answered.
 */
export interface OrpcAnswer {
  /** The procedure began: an error after this mark is not oRPC's decoding of the request but the encoding of the output. */
  entered?: true;
  /** The command id the invocation ran under: `Keelwerk-Command-Id`. */
  commandId?: string;
  /** The command was accepted and answers its receipt: status 202. */
  accepted?: true;
  /** The client sent `Prefer: respond-async`: only then is `Preference-Applied` set (RFC 7240). */
  preferred?: true;
  /** The invoker replayed a stored outcome: `Idempotent-Replayed`. */
  replayed?: true;
  /** The ids of the deferred effects: `Keelwerk-Effects`. */
  effects?: readonly string[];
  /** The failure the request ended with: `Retry-After` and `WWW-Authenticate`. */
  failure?: KeelwerkError;
  /** The action is deprecated: `Deprecation`, `Sunset` and `Link`. */
  deprecated?: NonNullable<SurfaceAction['deprecated']>;
}
