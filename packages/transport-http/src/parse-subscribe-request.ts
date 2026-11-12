import { coreError } from '@keelwerk/core/http';
import { parseJsonBody } from './parse-json-body.ts';
import { streamTokenOf } from './stream-token-of.ts';
import type { SubscribeRequest } from './subscribe-request.ts';
import { subscriptionRefOf } from './subscription-ref-of.ts';

const maxInputBytes = 8192;
const encoder = new TextEncoder();

/** The values never reach the message: a hostile token is never echoed or logged. */
function malformed(path: string, message: string) {
  return coreError('core.malformed_request', { issues: [{ path: [path], message }] });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The one value of a query member; none is undefined, several are malformed. */
function oneOf(params: URLSearchParams, name: string): string | undefined {
  const all = params.getAll(name);
  if (all.length > 1) throw malformed(name, 'Expected one value.');
  return all[0];
}

/**
 * The request of `GET` or `POST /_keelwerk/v1/subscribe`. GET: the query holds `action` (at most 256
 * bytes), `input` (JSON, at most 8 KiB; absent: undefined) and `after`. POST: a JSON body
 * `{ action, input?, after? }` within the body limit. `Last-Event-ID` wins over `after`. A token is
 * one value of at most 128 characters of `0-9`, `a-z` and `.` in the form of a state token; anything
 * else is `core.malformed_request`, and the values never reach a message or a log.
 */
export function parseSubscribeRequest(request: Request, bytes: Uint8Array): SubscribeRequest {
  const lastEventId = request.headers.get('last-event-id');
  const header = lastEventId === null || lastEventId === '' ? undefined : lastEventId;
  if (request.method === 'POST') {
    const body = parseJsonBody(bytes);
    if (!isRecord(body)) throw malformed('body', 'Expected an object.');
    const after =
      header ?? (body.after === undefined ? undefined : streamTokenOf(body.after, 'after'));
    return {
      action: subscriptionRefOf(body.action),
      input: body.input,
      ...(after === undefined
        ? {}
        : { after: streamTokenOf(after, header === undefined ? 'after' : 'Last-Event-ID') }),
    };
  }
  const params = new URL(request.url).searchParams;
  const action = oneOf(params, 'action');
  const text = oneOf(params, 'input');
  const query = oneOf(params, 'after');
  let input: unknown;
  if (text !== undefined) {
    if (encoder.encode(text).byteLength > maxInputBytes) {
      throw malformed('input', 'The input of a GET is at most 8 KiB: use POST for more.');
    }
    try {
      input = JSON.parse(text);
    } catch {
      throw malformed('input', 'Expected JSON.');
    }
  }
  const token = header ?? (query === '' ? undefined : query);
  return {
    action: subscriptionRefOf(action),
    input,
    ...(token === undefined
      ? {}
      : { after: streamTokenOf(token, header === undefined ? 'after' : 'Last-Event-ID') }),
  };
}
