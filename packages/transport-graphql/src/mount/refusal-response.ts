import type { KeelwerkError } from '@keelwerk/core';
import { statusOfError, wwwAuthenticateValue } from '@keelwerk/core/http';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';

/**
 * The answer to a request the gate refuses (before any resolver): `{ errors: [...] }` in the
 * GraphQL error form as `application/graphql-response+json`, with the HTTP status of the error's
 * kind (section 16.4.6); a refused method adds `Allow: POST`.
 */
export function refusalResponse(
  error: KeelwerkError,
  context: Pick<GraphqlContext, 'session' | 'development' | 'requestId' | 'log'>,
  status: number = statusOfError(error),
): Response {
  const headers = new Headers({
    'content-type': 'application/graphql-response+json; charset=utf-8',
  });
  if (status === 405) headers.set('allow', 'POST');
  if (status === 401) headers.set('www-authenticate', wwwAuthenticateValue);
  if (error.retryAfter !== undefined) headers.set('retry-after', String(error.retryAfter));
  return new Response(JSON.stringify({ errors: [graphqlErrorOf(error, context).toJSON()] }), {
    status,
    headers,
  });
}
