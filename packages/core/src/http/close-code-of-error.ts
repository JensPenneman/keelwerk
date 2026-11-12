import type { ErrorKind } from '../errors/error-kind.ts';

/**
 * The WebSocket close code of an error kind (16.4.6): validation 4400, unauthenticated 4401,
 * forbidden 4403, not_found 4404, conflict 4409, rate_limited 4429, not_implemented 4501,
 * unavailable 1013, unsupported 4422, internal 1011.
 */
export function closeCodeOfError(kind: ErrorKind): number {
  switch (kind) {
    case 'validation':
      return 4400;
    case 'unauthenticated':
      return 4401;
    case 'forbidden':
      return 4403;
    case 'not_found':
      return 4404;
    case 'conflict':
      return 4409;
    case 'rate_limited':
      return 4429;
    case 'not_implemented':
      return 4501;
    case 'unavailable':
      return 1013;
    case 'unsupported':
      return 4422;
    case 'internal':
      return 1011;
  }
}
