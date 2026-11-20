import type { ErrorKind } from '@keelwerk/core';
import {
  type Decoded,
  decodeAnswer,
  originOf,
  requestHeaders,
  type TransportCodec,
} from '@keelwerk/testing';
import { orpcPathFor } from './orpc-path-for.ts';
import { orpcSubscribeOver } from './orpc-subscribe-over.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The wire value of an answer: oRPC's `{ json, meta }` carries the 16.4.2 strings in `json` in both serialiser modes. */
function jsonOf(body: unknown): unknown {
  return isRecord(body) && Object.hasOwn(body, 'json') ? body.json : body;
}

function decodedOf(body: unknown, status: number): Decoded {
  if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    // The host answers its own errors (no tenant, a failed origin check) in the envelope on every route.
    return { ok: false, kind: String(body.error.kind), code: String(body.error.code) };
  }
  const json = jsonOf(body);
  if (status < 400) return { ok: true, value: json, accepted: status === 202 };
  const data = isRecord(json) ? json.data : undefined;
  if (isRecord(data) && typeof data.kind === 'string' && typeof data.code === 'string') {
    return { ok: false, kind: data.kind as ErrorKind, code: data.code };
  }
  return { ok: false, kind: 'unparsed', code: String(status) };
}

/**
 * oRPC (16.7.7): one procedure per call over `POST /orpc/<module>/<action>` with `{ json: input }`
 * (`ifVersion` joins the input), the command id as `Idempotency-Key` and `Prefer: respond-async`.
 * The answer is decoded from `body.json`, which holds the wire values in both serialiser modes, with
 * the status of oRPC's own response (202 for an accepted command). `Sent.body` is the receipt of an
 * accepted command and the value of a success, the whole body of an error.
 */
export const orpcCodec: TransportCodec = {
  name: 'oRPC',
  endpoint: '/orpc',
  async send(target, call) {
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    headers.set('content-type', 'application/json');
    if (call.commandId !== undefined) headers.set('idempotency-key', call.commandId);
    if (call.prefer === 'async') headers.set('prefer', 'respond-async');
    const input =
      call.ifVersion === undefined ? call.input : { ...call.input, ifVersion: call.ifVersion };
    const response = await target.fetch(
      new Request(
        `${originOf(target, caller)}${caller.pathPrefix ?? ''}/orpc/${orpcPathFor(call.action)}`,
        { method: 'POST', headers, body: JSON.stringify({ json: input ?? {} }) },
      ),
    );
    const real = await decodeAnswer(response, true);
    const decoded = decodedOf(real.body, response.status);
    return { decoded, body: decoded.ok ? jsonOf(real.body) : real.body, response };
  },
  receiptLocationOf: () => null,
  expectedReceiptLocation: () => null,
  rowVersionOf(sent) {
    const value =
      sent.decoded.ok && isRecord(sent.decoded.value) ? sent.decoded.value.version : undefined;
    return typeof value === 'number' ? value : null;
  },
  commandIdOf: (sent) => sent.response.headers.get('keelwerk-command-id'),
  reportsChosenCommandId: true,
  isReplay: (sent) => sent.response.headers.get('idempotent-replayed') === 'true',
  marksReplays: true,
  configurableCors: true,
  followsRelations: false,
  subscribePath: '/orpc',
  streamWelcome: false,
  subscribe: (target, call) => orpcSubscribeOver(target, call, '/orpc'),
};
