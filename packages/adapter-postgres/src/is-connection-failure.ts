import { isKeelwerkError } from '@keelwerk/core';

const failureCodes: ReadonlySet<string> = new Set([
  '57P01',
  '57P02',
  '57P03',
  '57P04',
  '57P05',
  '25P03',
  '25P04',
  '53300',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const failureMessages: ReadonlySet<string> = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
  'Cannot use a pool after calling end on the pool',
  'driver has already been destroyed',
]);

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * True when `error` says the connection to the server was lost or could not be opened: SQLSTATE
 * class 08, 57P01 to 57P05 (the server shuts down, crashes, refuses, drops the database or ends an
 * idle session), 25P03 and 25P04 (the idle-in-transaction timeout and the transaction timeout end
 * the session) or 53300; a socket error code; or one of the driver's messages that carry no
 * code. Never true for a KeelwerkError.
 */
export function isConnectionFailure(error: unknown): boolean {
  if (isKeelwerkError(error)) return false;
  const code = codeOf(error);
  if (code !== undefined) return code.startsWith('08') || failureCodes.has(code);
  return error instanceof Error && failureMessages.has(error.message);
}
