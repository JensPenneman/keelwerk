import type { InvocationSession, Outcome, ResponseHint } from '@keelwerk/core';
import { commandReceiptId, errors, receiptScopeId } from '@keelwerk/core';
import { applyCookieHint } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import { deprecationHeaders } from './deprecation-headers.ts';
import { encodeRow } from './encode-row.ts';
import { etagOf } from './etag-of.ts';
import { noneMatchHit } from './none-match-hit.ts';
import { pageLinks } from './page-links.ts';
import type { RestRoute } from './rest-route.ts';

type Success = Extract<Outcome<unknown>, { readonly ok: true }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  return new Response(
    JSON.stringify(body, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
    { status, headers },
  );
}

function bytesOf(value: unknown): Uint8Array<ArrayBuffer> | string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return value instanceof Uint8Array ? new Uint8Array(value) : undefined;
}

function hinted(hint: ResponseHint, value: unknown, headers: Headers): Response | undefined {
  const member = (from: string) => (isRecord(value) ? value[from] : undefined);
  switch (hint.kind) {
    case 'json':
      return undefined;
    case 'empty':
      return new Response(null, { status: hint.status ?? 204, headers });
    case 'redirect': {
      const target = member(hint.from);
      if (typeof target !== 'string') {
        throw errors.internal(`The output has no '${hint.from}' to redirect to.`);
      }
      headers.set('location', target);
      return new Response(null, { status: hint.status ?? 302, headers });
    }
    case 'raw':
    case 'download': {
      const body = bytesOf(member(hint.from));
      if (body === undefined) {
        throw errors.internal(`The output has no '${hint.from}' to send.`);
      }
      headers.set(
        'content-type',
        hint.kind === 'raw' ? hint.contentType : 'application/octet-stream',
      );
      headers.set(
        'content-length',
        String(
          typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength,
        ),
      );
      if (hint.kind === 'download') {
        headers.set('content-disposition', 'attachment');
      }
      return new Response(body, { status: 200, headers });
    }
  }
}

function listOf(value: unknown, key: string): readonly unknown[] | undefined {
  const list = isRecord(value) ? value[key] : undefined;
  return Array.isArray(list) ? list : undefined;
}

function versionOf(row: unknown): number | bigint | undefined {
  const version = isRecord(row) ? row.version : undefined;
  return typeof version === 'number' || typeof version === 'bigint' ? version : undefined;
}

function rowResponse(
  context: ResponseContext,
  row: unknown,
  status: number,
  headers: Headers,
): Response {
  const { route } = context;
  if (route.entity === undefined) {
    throw errors.internal('A row route has no entity.');
  }
  const version = versionOf(row);
  const etag = version === undefined ? undefined : etagOf(version);
  if (etag !== undefined) {
    headers.set('etag', etag);
  }
  if (route.mode === 'get-one' && etag !== undefined && noneMatchHit(context.ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  const encoded = encodeRow(route.entity, row);
  if (route.creates && isRecord(encoded) && typeof encoded.id === 'string') {
    headers.set('location', `${context.mountPath}${route.path}/${encodeURIComponent(encoded.id)}`);
  }
  return json(status, encoded, headers);
}

function body(context: ResponseContext, outcome: Success, headers: Headers): Response {
  const { route } = context;
  const { action, entity } = route;
  const { value } = outcome;
  switch (action.generated) {
    case 'get':
      if (route.mode === 'get-one') {
        const row = listOf(value, 'list')?.[0] ?? listOf(value, 'items')?.[0];
        if (row === undefined) {
          throw errors.not_found('The row does not exist.');
        }
        return rowResponse(context, row, 200, headers);
      }
      if (entity !== undefined && isRecord(value)) {
        const list = listOf(value, 'list');
        if (list !== undefined) {
          return json(200, { ...value, list: list.map((row) => encodeRow(entity, row)) }, headers);
        }
      }
      break;
    case 'create':
      return rowResponse(context, value, 201, headers);
    case 'update':
    case 'archive':
    case 'restore':
      return rowResponse(context, value, 200, headers);
    case 'query':
      if (entity !== undefined && isRecord(value) && Array.isArray(value.items)) {
        const link =
          route.method === 'GET'
            ? pageLinks(new URL(context.request.url), value.pageInfo)
            : undefined;
        if (link !== undefined) {
          headers.append('link', link);
        }
        return json(
          200,
          { ...value, items: value.items.map((row: unknown) => encodeRow(entity, row)) },
          headers,
        );
      }
      break;
    default:
      break;
  }
  if (action.output.kind === 'void') {
    return new Response(null, { status: 204, headers });
  }
  const encoded = toWire(action.output, value);
  if (encoded === undefined) {
    return new Response(null, { status: 204, headers });
  }
  const link =
    route.method === 'GET' && action.output.kind === 'page' && isRecord(encoded)
      ? pageLinks(new URL(context.request.url), encoded.pageInfo)
      : undefined;
  if (link !== undefined) {
    headers.append('link', link);
  }
  const cookie = applyCookieHint(
    action.hints.http?.cookie,
    encoded,
    context.session,
    context.request.headers,
  );
  for (const setCookie of cookie.setCookies) {
    headers.append('set-cookie', setCookie);
  }
  return json(200, cookie.value, headers);
}

/**
 * Turns a successful outcome into the response of 16.5.3: the row, page or output as JSON (204 for
 * a void output), the headers `ETag`, `Location`, `Link`, `Keelwerk-Command-Id`, `Keelwerk-Effects`,
 * `Preference-Applied` and `Idempotent-Replayed`, 304 on a matching `If-None-Match`, and 202 with
 * `Location` for an accepted command (S-24).
 */
export function encodeResponse(outcome: Success, context: ResponseContext): Response {
  const { route, session } = context;
  const { action } = route;
  const headers = new Headers();
  headers.set('x-request-id', context.requestId);
  headers.set('keelwerk-version', session.apiVersion);
  if (action.kind === 'command' && context.commandId !== undefined) {
    headers.set('keelwerk-command-id', context.commandId);
  }
  if (outcome.effects !== undefined && outcome.effects.length > 0) {
    headers.set('keelwerk-effects', outcome.effects.join(','));
  }
  if (outcome.replayed === true) {
    headers.set('idempotent-replayed', 'true');
  }
  deprecationHeaders(headers, action.deprecated, `${context.mountPath}/docs`);
  if (outcome.receipt !== undefined) {
    // The receipt lives in the scope the command ran in, and `core.commandReceipt.get` reads in the
    // session's own scope (S-102): the link is written only when the receipt's scope is the
    // session's; a backend command of a tenant session has its receipt in the backend, which the
    // tenant cannot read.
    if (action.scope === session.scope.level) {
      headers.set(
        'location',
        `${context.mountPath}/core/command-receipts/${commandReceiptId(
          receiptScopeId(session.scope, context.deploymentId),
          outcome.receipt.commandId,
        )}`,
      );
    }
    if (context.preferredAsync) {
      headers.set('preference-applied', 'respond-async');
    }
    return json(202, outcome.receipt, headers);
  }
  const hint = action.hints.http?.response;
  const custom = hint === undefined ? undefined : hinted(hint, outcome.value, headers);
  return custom ?? body(context, outcome, headers);
}

/** What the response needs besides the outcome. */
export interface ResponseContext {
  readonly route: RestRoute;
  readonly request: Request;
  readonly session: InvocationSession;
  readonly requestId: string;
  readonly deploymentId: string;
  /** The path the transport is mounted at (the base path, after any tenant prefix): `Location`, `Link`. */
  readonly mountPath: string;
  /** The command id of this request: sent by the client or generated by the transport. */
  readonly commandId?: string;
  /** The client sent `Prefer: respond-async` to an `either` command, so an accepted receipt honours it. */
  readonly preferredAsync: boolean;
  readonly ifNoneMatch: readonly string[];
}
