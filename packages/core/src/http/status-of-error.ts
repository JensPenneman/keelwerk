import type { KeelwerkError } from '../errors/keelwerk-error.ts';

const malformedCodes: ReadonlySet<string> = new Set([
  'core.malformed_request',
  'core.api_version_invalid',
  'core.api_version_unknown',
]);

/** The HTTP status of an error: the REST column of section 16.4.6, which the invocation protocol follows. */
export function statusOfError(error: Pick<KeelwerkError, 'kind' | 'code'>): number {
  switch (error.kind) {
    case 'validation':
      if (error.code === 'core.payload_too_large') {
        return 413;
      }
      return malformedCodes.has(error.code) ? 400 : 422;
    case 'unauthenticated':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return error.code === 'core.api_version_retired' || error.code === 'core.protocol_retired'
        ? 410
        : 404;
    case 'conflict':
      if (error.code === 'core.version_mismatch' || error.code === 'core.state_mismatch') {
        return 412;
      }
      return error.code === 'core.idempotency_mismatch' ? 422 : 409;
    case 'rate_limited':
      return 429;
    case 'not_implemented':
      return 501;
    case 'unavailable':
      return 503;
    case 'unsupported':
      return 422;
    case 'internal':
      return 500;
  }
}
