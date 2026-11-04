import type { ErrorKind, WireError } from '@keelwerk/core';

function byKind(kind: ErrorKind): number {
  switch (kind) {
    case 'validation':
      return 3;
    case 'unauthenticated':
      return 4;
    case 'forbidden':
      return 5;
    case 'not_found':
      return 6;
    case 'conflict':
      return 7;
    case 'rate_limited':
      return 8;
    case 'not_implemented':
      return 9;
    case 'unavailable':
      return 10;
    case 'unsupported':
      return 11;
    case 'internal':
      return 1;
  }
}

/** Exit code for an outcome (section 16.4.6): by error kind, 2 for usage, 130 for an interrupt. */
export function exitCodeFor(error: WireError | 'usage' | 'interrupted'): number {
  if (error === 'usage') {
    return 2;
  }
  if (error === 'interrupted') {
    return 130;
  }
  return byKind(error.kind);
}
