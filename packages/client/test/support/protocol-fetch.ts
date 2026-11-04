import type { ApiSurface, FieldNode, WireError } from '@keelwerk/core';
import { fromWire, toWire } from '@keelwerk/core/wire';

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function decodeInput(node: FieldNode, wire: unknown): unknown {
  const result = fromWire(node, wire);
  if (result.issues !== undefined) {
    throw new Error(`the fake server cannot decode the input: ${result.issues[0]?.message}`);
  }
  return result.value;
}

/** What a request looked like when it reached the fake server. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/** What a handler answers: a value (in-process form), a receipt, effects, or an error of the taxonomy. */
export type ServerAnswer =
  | { readonly value?: unknown; readonly effects?: readonly string[] }
  | { readonly receipt: { readonly commandId: string; readonly status: 'accepted' } }
  | { readonly error: Omit<WireError, 'requestId'>; readonly status: number };

export interface ProtocolFetchOptions {
  readonly surface: ApiSurface;
  /** Handlers by action; they get the input decoded to its in-process form. */
  readonly handlers: Readonly<
    Record<string, (input: unknown, commandId: string | undefined) => ServerAnswer>
  >;
  /** The first n requests (after the dropped ones) answer 503 with an HTML body. */
  readonly gatewayFirst?: number;
}

export interface ProtocolFetch {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

/** A `fetch` that speaks the invocation protocol of section 16.8.2 against a fixed surface. */
export function protocolFetch(options: ProtocolFetchOptions): ProtocolFetch {
  const requests: RecordedRequest[] = [];
  let gateways = 0;
  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    requests.push({
      method: request.method,
      path: url.pathname,
      headers: request.headers,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    });
    if (gateways < (options.gatewayFirst ?? 0)) {
      gateways += 1;
      return new Response('<html>bad gateway</html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.pathname === '/_keelwerk/v1/surface') {
      return json(200, options.surface, { etag: `"${options.surface.hash}"` });
    }
    const body = JSON.parse(text) as {
      action: string;
      input?: unknown;
      commandId?: string;
    };
    const action = options.surface.actions.find((a) => a.ref === body.action);
    const handler = options.handlers[body.action];
    if (action === undefined || handler === undefined) {
      return json(404, {
        ok: false,
        error: {
          kind: 'not_found',
          code: 'core.not_found',
          message: 'No such action.',
          retryable: false,
          requestId: 'req-1',
        },
      });
    }
    const answer = handler(decodeInput(action.input, body.input), body.commandId);
    if ('error' in answer) {
      return json(answer.status, { ok: false, error: { ...answer.error, requestId: 'req-1' } });
    }
    if ('receipt' in answer) {
      return json(202, { ok: true, value: answer.receipt, receipt: answer.receipt });
    }
    return json(200, {
      ok: true,
      ...(answer.value !== undefined && { value: toWire(action.output, answer.value) }),
      ...(answer.effects !== undefined && { effects: answer.effects }),
    });
  };
  return { fetch: handle as typeof fetch, requests };
}
