import { coreError } from '@keelwerk/core/http';
import { graphqlParamsOf } from './graphql-params-of.ts';
import type { GraphqlRequestBody } from './graphql-request-body.ts';

function malformed(message: string): Error {
  return coreError('core.malformed_request', { message });
}

function tooLarge(maxBodyBytes: number): Error {
  return coreError('core.payload_too_large', {
    message: `The request body is larger than ${maxBodyBytes} bytes.`,
  });
}

/** The body as text, never reading beyond the bound: the declared length is checked first, then the bytes as they arrive. */
async function boundedText(request: Request, maxBodyBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw tooLarge(maxBodyBytes);
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw tooLarge(maxBodyBytes);
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
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
