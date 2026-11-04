import type { ApiSurface } from '@keelwerk/core';
import { clientFailure } from './client-failure.ts';
import { errorOfEnvelope } from './error-of-envelope.ts';
import type { RemoteConnection } from './remote-connection.ts';
import { requestHeaders } from './request-headers.ts';
import { sendWithRetry } from './send-with-retry.ts';

function isSurface(value: unknown): value is ApiSurface {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly format?: unknown }).format === 'keelwerk.surface/1'
  );
}

/** `GET /_keelwerk/v1/surface` at the client's API version. */
export async function loadSurface(connection: RemoteConnection): Promise<ApiSurface> {
  const { response, body } = await sendWithRetry(
    connection.send,
    `${connection.origin}/_keelwerk/v1/surface`,
    { method: 'GET', headers: requestHeaders(connection, false) },
    connection.retry,
    undefined,
  );
  if (!response.ok || !isSurface(body)) {
    throw errorOfEnvelope(body, response.status, undefined);
  }
  if (body.apiVersion !== connection.apiVersion) {
    throw clientFailure(
      'core.internal',
      `The server answered the surface of ${body.apiVersion}, the client was compiled for ${connection.apiVersion}.`,
    );
  }
  return body;
}
