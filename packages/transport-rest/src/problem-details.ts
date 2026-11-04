import type { ErrorAudience, ErrorKind, KeelwerkError } from '@keelwerk/core';
import { toWire } from '@keelwerk/core';
import { statusOfError } from './status-of-error.ts';

const titles: Readonly<Record<ErrorKind, string>> = {
  validation: 'Validation',
  unauthenticated: 'Unauthenticated',
  forbidden: 'Forbidden',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_found: 'Not found',
  conflict: 'Conflict',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  rate_limited: 'Rate limited',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_implemented: 'Not implemented',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
  internal: 'Internal error',
};

/** What a problem response needs besides the error. */
export interface ProblemContext {
  readonly request: Request;
  /** The path the transport is mounted at; the `type` URI resolves under it (section 16.5.4). */
  readonly mountPath: string;
  readonly requestId: string;
  readonly audience: ErrorAudience;
  readonly apiVersion?: string;
}

/**
 * An RFC 9457 problem document (section 16.5.4): `type` an absolute URI built from the request's
 * origin and mount path, `title` the taxonomy title of the kind, `detail` the message, `instance`
 * the request id as a `urn:uuid`, and the rest of the core's `WireError`. What an audience sees is
 * decided by the core's `toWire`, never here.
 */
export function problemResponse(error: KeelwerkError, context: ProblemContext): Response {
  const status = statusOfError(error);
  const { message, ...wire } = toWire(error, context.audience);
  const origin = new URL(context.request.url).origin;
  const headers = new Headers({
    'content-type': 'application/problem+json',
    'x-request-id': context.requestId,
  });
  if (context.apiVersion !== undefined) {
    headers.set('keelwerk-version', context.apiVersion);
  }
  if (error.retryAfter !== undefined && (status === 429 || status === 503)) {
    if (error.code !== 'core.quota_exceeded') {
      headers.set('retry-after', String(Math.ceil(error.retryAfter)));
    }
  }
  if (status === 401) {
    headers.set('www-authenticate', 'Bearer');
  }
  const body = {
    type: `${origin}${context.mountPath}/problems/${error.code}`,
    title: titles[error.kind],
    status,
    detail: message,
    instance: `urn:uuid:${context.requestId}`,
    ...wire,
    requestId: context.requestId,
  };
  return new Response(JSON.stringify(body), { status, headers });
}
