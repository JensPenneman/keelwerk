import { coreError, readBoundedBody } from '@keelwerk/core/http';
import { graphqlParamsOf } from './graphql-params-of.ts';
import type { GraphqlRequestBody } from './graphql-request-body.ts';

function malformed(message: string): Error {
  return coreError('core.malformed_request', { message });
}

/** The body as text: the bytes bounded by `readBoundedBody`, then decoded as strict UTF-8. */
async function boundedText(request: Request, maxBodyBytes: number): Promise<string> {
  const bytes = await readBoundedBody(request, maxBodyBytes);
  if (bytes === undefined) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw malformed('The request body is not valid UTF-8.');
  }
}

/**
 * Reads the GraphQL request of a POST (section 16.6.6, decision D7): the content type must be
 * `application/json` (parameters allowed), so a form, multipart or text/plain request, the only
 * kinds a page of another site can send without a preflight, never reaches execution. The body is
 * bounded by `maxBodyBytes` before it is parsed, and its variables by a nesting depth of 64 (`graphqlParamsOf`). It is one request object or a non-empty array of
 * them; a persisted operation (no `query`) is refused, since persisted operations are not served.
 */
export async function readGraphqlParams(
  request: Request,
  maxBodyBytes: number,
): Promise<GraphqlRequestBody> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    throw malformed('The content type must be application/json.');
  }
  const text = await boundedText(request, maxBodyBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw malformed('The request body is not valid JSON.');
  }
  if (Array.isArray(body)) {
    if (body.length === 0) throw malformed('A batch must hold at least one request.');
    return { batch: true, params: body.map(graphqlParamsOf) };
  }
  return { batch: false, params: [graphqlParamsOf(body)] };
}
