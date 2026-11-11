import type { WireError } from '../errors/wire-error.ts';

/**
 * What a record of `core.effectAttempt` keeps of a failed attempt's error: the kind, the stable
 * code, whether it can be retried, the wait and the request id. Never the message, details,
 * issues, reason or rules: an executor's reply often quotes personal data (an address a mail
 * server refused), and a stream record is not sealed under the effect input's subjects. The full
 * error stays in `core.effect.error`, sealed with the effect input.
 */
export type EffectAttemptError = Pick<
  WireError,
  'kind' | 'code' | 'retryable' | 'retryAfter' | 'requestId'
>;
