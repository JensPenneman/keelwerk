import { coreError } from '@keelwerk/core/http';
import type { GraphqlParams } from './graphql-params.ts';
import type { GraphqlRequestBody } from './graphql-request-body.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/** How deep variables may nest: far deeper than any input type of a real surface, far shallower than the stack of a recursive coercion. */
const maxVariableDepth = 64;

/** Whether a JSON value nests deeper than `limit` levels; walks with its own stack, so no depth can overflow it. */
function nestsDeeperThan(value: unknown, limit: number): boolean {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (typeof item.value !== 'object' || item.value === null) continue;
    if (item.depth + 1 > limit) return true;
    for (const member of Object.values(item.value)) {
      pending.push({ value: member, depth: item.depth + 1 });
    }
  }
  return false;
}

function paramsOf(item: unknown): GraphqlParams {
  if (!isRecord(item)) throw malformed('A GraphQL request must be a JSON object.');
  const { query, operationName, variables, extensions } = item;
  if (typeof query !== 'string') {
    const persisted = isRecord(extensions) && extensions.persistedQuery !== undefined;
    throw malformed(
      persisted
        ? 'Persisted operations are not served; send the query text.'
        : 'A GraphQL request needs a `query` string.',
    );
  }
  if (operationName !== undefined && operationName !== null && typeof operationName !== 'string') {
    throw malformed('`operationName` must be a string.');
  }
  if (variables !== undefined && variables !== null && !isRecord(variables)) {
    throw malformed('`variables` must be a JSON object.');
  }
  if (nestsDeeperThan(variables, maxVariableDepth)) {
    throw malformed(`The variables nest deeper than ${maxVariableDepth} levels.`);
  }
  return {
    query,
    ...(typeof operationName === 'string' ? { operationName } : {}),
    ...(isRecord(variables) ? { variables } : {}),
  };
}

/**
 * Reads the GraphQL request of a POST (section 16.6.6, decision D7): the content type must be
 * `application/json` (parameters allowed), so a form, multipart or text/plain request, the only
 * kinds a page of another site can send without a preflight, never reaches execution. The body is
 * bounded by `maxBodyBytes` before it is parsed, and its variables by a nesting depth of 64. It is one request object or a non-empty array of
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
    return { batch: true, params: body.map(paramsOf) };
  }
  return { batch: false, params: [paramsOf(body)] };
}
