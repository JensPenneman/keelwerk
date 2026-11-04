import type { ErrorKind, WireError } from '@keelwerk/core';
import { ClientError } from './client-error.ts';
import { clientFailure } from './client-failure.ts';
import { decodeWithSurface } from './decode-with-surface.ts';
import { isRecord } from './is-record.ts';
import type { LoadedSurface } from './surface-cache.ts';

const kinds: ReadonlySet<string> = new Set<ErrorKind>([
  'validation',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'not_implemented',
  'unavailable',
  'unsupported',
  'internal',
]);

/** The error an `{ ok: false, error }` envelope carries, with declared details decoded by the surface when it is at hand. */
export function errorOfEnvelope(
  body: unknown,
  status: number,
  surface: LoadedSurface | undefined,
): ClientError {
  const wire = isRecord(body) && body.ok === false ? body.error : undefined;
  if (
    !isRecord(wire) ||
    typeof wire.kind !== 'string' ||
    !kinds.has(wire.kind) ||
    typeof wire.code !== 'string' ||
    typeof wire.message !== 'string'
  ) {
    return clientFailure(
      'core.internal',
      `The server answered ${status} without an error envelope.`,
    );
  }
  const data = surface?.errors.get(wire.code)?.data;
  let details = wire.details;
  if (data !== undefined && details !== undefined) {
    try {
      details = decodeWithSurface(data, details, `the details of ${wire.code}`);
    } catch {
      details = wire.details;
    }
  }
  return new ClientError({
    kind: wire.kind as ErrorKind,
    code: wire.code,
    message: wire.message,
    retryable: wire.retryable === true,
    ...(Array.isArray(wire.issues) && { issues: wire.issues as WireError['issues'] & object }),
    ...(details !== undefined && { details }),
    ...(typeof wire.retryAfter === 'number' && { retryAfter: wire.retryAfter }),
    ...(typeof wire.reason === 'string' && { reason: wire.reason }),
    ...(Array.isArray(wire.rules) && { rules: wire.rules as WireError['rules'] & object }),
    ...(typeof wire.requestId === 'string' && { requestId: wire.requestId }),
  });
}
