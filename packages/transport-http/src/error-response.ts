import type { KeelwerkError } from '@keelwerk/core';
import { statusOfError, wwwAuthenticateValue } from '@keelwerk/core/http';
import type { HostContext } from './host-context.ts';
import { jsonResponse } from './json-response.ts';
import { problemResponseOf } from './problem-response-of.ts';
import type { RequestState } from './request-state.ts';
import { wireErrorOf } from './wire-error-of.ts';

/** The envelope response of an error, with the status, `Retry-After` and `WWW-Authenticate` its kind needs. */
export function errorResponse(
  host: HostContext,
  state: RequestState,
  error: KeelwerkError,
): Response {
  const status = statusOfError(error);
  const headers = new Headers();
  if (error.retryAfter !== undefined && error.code !== 'core.quota_exceeded') {
    headers.set('retry-after', String(Math.ceil(error.retryAfter)));
  }
  if (status === 401) {
    headers.set('www-authenticate', wwwAuthenticateValue);
  }
  state.failure = { kind: error.kind, code: error.code };
  if (error.kind === 'internal') {
    host.deps.log.child({ requestId: state.requestId }).error('request failed', {
      code: error.code,
      cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? ''),
    });
  }
  if (state.problemBase !== undefined) {
    return problemResponseOf(host, state, error, status, headers, state.problemBase);
  }
  return jsonResponse(status, wireErrorOf(host, state, error), headers);
}
