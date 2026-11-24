import {
  type Call,
  decodeAnswer,
  originOf,
  readEventStream,
  requestHeaders,
  type TransportCodec,
} from '@keelwerk/testing';
import { type RestRoute, restRoutes } from './rest-routes.ts';

function bodyOf(
  route: RestRoute,
  input: Call['input'],
  rest: Readonly<Record<string, unknown>>,
): unknown {
  if (route.patch === true) return input?.patch ?? {};
  return route.path.includes(':id') ? rest : input;
}

/** The compact `sort=-title,author` form of a list of `{ field, direction }` (16.4.4). */
function compactSort(value: unknown): string {
  const keys = value as readonly { readonly field: string; readonly direction?: 'asc' | 'desc' }[];
  return keys.map((key) => `${key.direction === 'desc' ? '-' : ''}${key.field}`).join(',');
}

/** REST (16.5): the action's route, the input as body or query string, `Idempotency-Key`, `Prefer` and `If-Match`. */
export const restCodec: TransportCodec = {
  name: 'REST',
  endpoint: '/api/loans/lend',
  subscribePath: '/api/loans/loan-events',
  /** A subscription on its own route (15.4.8): `GET`, the input members and `after` in the query, `Last-Event-ID` as the header. */
  async subscribe(target, call) {
    const route = restRoutes[call.action];
    if (route?.stream !== true) {
      throw new Error(`The suite has no REST stream route for '${call.action}'.`);
    }
    if (call.method === 'POST') throw new Error('A REST subscription is opened with GET.');
    if (call.ticket !== undefined) throw new Error('A REST subscription path takes no ticket.');
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    headers.set('accept', 'text/event-stream');
    if (call.lastEventId !== undefined) headers.set('last-event-id', call.lastEventId);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries((call.input ?? {}) as Record<string, unknown>)) {
      if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
      else params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    if (call.after !== undefined) params.set('after', call.after);
    const query = params.size === 0 ? '' : `?${params.toString()}`;
    const options = call.remoteAddress === undefined ? {} : { remoteAddress: call.remoteAddress };
    const response = await target.fetch(
      new Request(`${originOf(target, caller)}${caller.pathPrefix ?? ''}${route.path}${query}`, {
        headers,
      }),
      options,
    );
    return readEventStream(response);
  },
  async send(target, call) {
    const route = restRoutes[call.action];
    if (route === undefined) {
      throw new Error(`The suite has no REST route for '${call.action}'.`);
    }
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    const { id, ...rest } = call.input ?? {};
    const path = route.path.replace(':id', encodeURIComponent(String(id ?? '')));
    const params = new URLSearchParams();
    if (route.query === true) {
      for (const [key, value] of Object.entries(call.input ?? {})) {
        params.set(
          key,
          key === 'sort'
            ? compactSort(value)
            : typeof value === 'string'
              ? value
              : JSON.stringify(value),
        );
      }
    }
    if (call.commandId !== undefined) headers.set('idempotency-key', call.commandId);
    if (call.prefer === 'async') headers.set('prefer', 'respond-async');
    if (call.ifVersion !== undefined) headers.set('if-match', `"${call.ifVersion}"`);
    const hasBody = route.method !== 'GET' && route.method !== 'DELETE';
    if (hasBody) headers.set('content-type', 'application/json');
    const query = params.size === 0 ? '' : `?${params.toString()}`;
    const response = await target.fetch(
      new Request(`${originOf(target, caller)}${caller.pathPrefix ?? ''}${path}${query}`, {
        method: route.method,
        headers,
        ...(hasBody && { body: JSON.stringify(bodyOf(route, call.input, rest)) }),
      }),
    );
    return decodeAnswer(response, false);
  },
  receiptLocationOf: (sent) => sent.response.headers.get('location'),
  expectedReceiptLocation: (receiptId) => `/api/core/command-receipts/${receiptId}`,
  rowVersionOf(sent) {
    const tag = sent.response.headers.get('etag');
    const version = tag === null ? Number.NaN : Number(tag.replaceAll('"', ''));
    return Number.isInteger(version) ? version : null;
  },
  commandIdOf: (sent) => sent.response.headers.get('keelwerk-command-id'),
  reportsChosenCommandId: true,
  isReplay: (sent) => sent.response.headers.get('idempotent-replayed') === 'true',
  configurableCors: true,
  marksReplays: true,
};
