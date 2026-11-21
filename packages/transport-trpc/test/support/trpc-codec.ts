import { deriveSurface, type ErrorKind, type SurfaceAction } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import {
  type Call,
  type Decoded,
  decodeAnswer,
  originOf,
  requestHeaders,
  type TransportCodec,
} from '@keelwerk/testing';
import { trpcPathOf } from '../../src/router/trpc-path-of.ts';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { superjsonValueOf } from '../../src/transformer/superjson-value-of.ts';
import { superjsonWireOf } from '../../src/transformer/superjson-wire-of.ts';
import { trpcConformanceApp, trpcConformanceVersions } from './trpc-conformance-app.ts';
import { trpcSocketDialect } from './trpc-socket-dialect.ts';
import { trpcSubscribeOver } from './trpc-subscribe-over.ts';

const surface = deriveSurface(trpcConformanceApp as never, trpcConformanceVersions.head).surface;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionOf(ref: string): SurfaceAction {
  const action = surface.actions.find((candidate) => candidate.ref === ref);
  if (action === undefined) throw new Error(`The suite has no action '${ref}'.`);
  return action;
}

/** The value a transformed member of an answer holds: the superjson envelope read back with the transport's own instance. */
function revived(node: unknown): unknown {
  return isRecord(node) && 'json' in node ? keelwerkSuperjson().deserialize(node as never) : node;
}

/** The wire input of a call as a client sends it: revived to the superjson values, then written in the envelope. */
function envelopeOf(action: SurfaceAction, input: unknown): string {
  return JSON.stringify(
    keelwerkSuperjson().serialize(superjsonValueOf(action.input, input) as never),
  );
}

function decodedOf(body: unknown, action: SurfaceAction, accepted: boolean): Decoded {
  if (!isRecord(body)) return { ok: false, kind: 'unparsed', code: 'not_json' };
  // The host answers its own errors (no tenant, a failed origin check) in the protocol's envelope.
  if (body.ok === false && isRecord(body.error)) {
    return { ok: false, kind: String(body.error.kind), code: String(body.error.code) };
  }
  if (isRecord(body.error)) {
    const shape = revived(body.error);
    const keelwerk = isRecord(shape) && isRecord(shape.data) ? shape.data.keelwerk : undefined;
    if (isRecord(keelwerk)) {
      return { ok: false, kind: String(keelwerk.kind), code: String(keelwerk.code) };
    }
    return { ok: false, kind: 'unparsed', code: 'no_keelwerk_error' };
  }
  if (isRecord(body.result)) {
    const value = revived(body.result.data);
    return { ok: true, value: accepted ? value : superjsonWireOf(action.output, value), accepted };
  }
  return { ok: false, kind: 'unparsed', code: 'not_trpc' };
}

/**
 * tRPC (16.7): one procedure per call, a query as `GET /trpc/<path>?input=` and a command as
 * `POST /trpc/<path>`, both with the superjson envelope a client writes (the wire input revived to
 * its Temporal, bytes and bigint values first). The command id travels as `Idempotency-Key` and
 * the preference as `Prefer`. The answer is read back as a client reads it and then flattened to
 * the wire with `superjsonWireOf`, so the shared cases see what REST carries. `Sent.response`
 * keeps the real headers and body and carries the 16.4.6 status of the decoded outcome (202 for an
 * accepted command), derived only from what the answer says, because a tRPC answer has no place
 * for those statuses. `Sent.body` is the real body, except that an accepted command's body is its
 * receipt.
 */
export const trpcCodec: TransportCodec = {
  name: 'tRPC',
  endpoint: '/trpc',
  async send(target, call: Call) {
    const caller = call.caller ?? {};
    const action = actionOf(call.action);
    const headers = requestHeaders(caller);
    const input =
      call.ifVersion === undefined ? call.input : { ...call.input, ifVersion: call.ifVersion };
    const base = `${originOf(target, caller)}${caller.pathPrefix ?? ''}/trpc/${trpcPathOf(action).join('.')}`;
    let request: Request;
    if (action.kind === 'command') {
      headers.set('content-type', 'application/json');
      if (call.commandId !== undefined) headers.set('idempotency-key', call.commandId);
      if (call.prefer === 'async') headers.set('prefer', 'respond-async');
      request = new Request(base, {
        method: 'POST',
        headers,
        ...(input === undefined || action.input.kind === 'void'
          ? {}
          : { body: envelopeOf(action, input) }),
      });
    } else {
      const query =
        input === undefined || action.input.kind === 'void'
          ? ''
          : `?input=${encodeURIComponent(envelopeOf(action, input))}`;
      request = new Request(`${base}${query}`, { headers });
    }
    const response = await target.fetch(request);
    const real = await decodeAnswer(response, true);
    const accepted =
      action.kind === 'command' && response.headers.get('preference-applied') === 'respond-async';
    const decoded = decodedOf(real.body, action, accepted);
    const status = decoded.ok
      ? decoded.accepted
        ? 202
        : 200
      : statusOfError({ kind: decoded.kind as ErrorKind, code: decoded.code });
    return {
      decoded,
      // The receipt of an accepted command is the body the shared cases read; the response keeps the real body.
      body: decoded.ok && decoded.accepted ? decoded.value : real.body,
      response: new Response(JSON.stringify(real.body ?? null), {
        status,
        headers: new Headers(response.headers),
      }),
    };
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
  isReplay: () => false,
  marksReplays: false,
  configurableCors: true,
  followsRelations: false,
  subscribePath: '/trpc',
  streamWelcome: false,
  subscribe: (target, call) => trpcSubscribeOver(target, call, surface),
  socket: trpcSocketDialect,
};
