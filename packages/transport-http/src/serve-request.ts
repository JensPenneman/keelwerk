import type { Carrier, InvocationSession, KeelwerkError } from '@keelwerk/core';
import { asKeelwerkError, asksForEventStream, coreError } from '@keelwerk/core/http';
import { batchEndpoint } from './batch-endpoint.ts';
import { bodyLimit } from './body-limit.ts';
import { capabilitiesEndpoint } from './capabilities-endpoint.ts';
import { carriesTicket } from './carries-ticket.ts';
import { dispatchUpgrade } from './dispatch-upgrade.ts';
import type { EndpointCall } from './endpoint-call.ts';
import { enrichCarrier } from './enrich-carrier.ts';
import { errorResponse } from './error-response.ts';
import { fillCarrier } from './fill-carrier.ts';
import type { HostBindings } from './host-bindings.ts';
import type { HostContext } from './host-context.ts';
import { invokeEndpoint } from './invoke-endpoint.ts';
import { isAllowedOrigin } from './is-allowed-origin.ts';
import { isStreamRequest } from './is-stream-request.ts';
import { isStreamResponse } from './is-stream-response.ts';
import { jsonResponse } from './json-response.ts';
import { mountPathOf } from './mount-path-of.ts';
import { originCheck } from './origin-check.ts';
import { serveSseStream } from './serve-sse-stream.ts';
import { socketFacts } from './socket-facts.ts';
import { spendRefusedTickets } from './spend-refused-tickets.ts';
import { subscribeEndpoint } from './subscribe-endpoint.ts';
import { surfaceEndpoint } from './surface-endpoint.ts';
import { ticketRefusal } from './ticket-refusal.ts';
import { wireErrorOf } from './wire-error-of.ts';
import { withStreamSlot } from './with-stream-slot.ts';

const reservedPrefix = '/_keelwerk';
const protocolBase = `${reservedPrefix}/v1`;
const bodyless: ReadonlySet<string> = new Set(['GET', 'HEAD']);

function methodNotAllowed(call: EndpointCall, allow: string): Response {
  const error = coreError('core.unsupported', {
    message: `Use ${allow} on this endpoint.`,
  });
  call.state.failure = { kind: error.kind, code: error.code };
  return jsonResponse(405, wireErrorOf(call.host, call.state, error), { allow });
}

async function protocolEndpoint(call: EndpointCall, path: string): Promise<Response> {
  const { method } = call.request;
  const safe = method === 'GET' || method === 'HEAD';
  call.state.transport = 'http';
  switch (path.slice(protocolBase.length)) {
    case '/invoke':
      call.state.route = `${protocolBase}/invoke`;
      return method === 'POST' ? invokeEndpoint(call) : methodNotAllowed(call, 'POST');
    case '/batch':
      call.state.route = `${protocolBase}/batch`;
      return method === 'POST' ? batchEndpoint(call) : methodNotAllowed(call, 'POST');
    case '/live':
      call.state.route = `${protocolBase}/live`;
      return errorResponse(
        call.host,
        call.state,
        coreError('core.unsupported', { message: 'Open this endpoint as a WebSocket.' }),
      );
    case '/subscribe':
      call.state.route = `${protocolBase}/subscribe`;
      return method === 'GET' || method === 'POST'
        ? subscribeEndpoint(call)
        : methodNotAllowed(call, 'GET, POST');
    case '/surface':
      call.state.route = `${protocolBase}/surface`;
      return safe ? surfaceEndpoint(call) : methodNotAllowed(call, 'GET');
    case '/capabilities':
      call.state.route = `${protocolBase}/capabilities`;
      return safe ? capabilitiesEndpoint(call) : methodNotAllowed(call, 'GET');
    default:
      return errorResponse(
        call.host,
        call.state,
        coreError('core.not_found', {
          message: 'There is no such endpoint.',
        }),
      );
  }
}

async function mounted(call: EndpointCall, path: string, streams: boolean): Promise<Response> {
  const { host, state, session, carrier, request } = call;
  const match = host.mounts.get(session.app)?.match(path);
  if (match === undefined) {
    return errorResponse(
      host,
      state,
      coreError('core.not_found', { message: 'There is no route for this path.' }),
    );
  }
  state.route = match.prefix === '/' ? '/*' : `${match.prefix}/*`;
  state.transport = match.transport;
  const forwarded =
    call.bytes.byteLength === 0
      ? request
      : new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: call.bytes,
          signal: request.signal,
        });
  // The one rule of path handling: the host strips the mount's prefix, the transport never does.
  const relative = mountPathOf(match.prefix, path);
  // Only a request the host counts as a stream (it holds its slot) may be answered on the carrier.
  const live =
    streams && asksForEventStream(request)
      ? host.deps.liveCarrier?.(session.app, 'sse')
      : undefined;
  const run = (): Promise<Response> =>
    match.handler(forwarded, {
      session,
      carrier,
      requestId: state.requestId,
      ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
      signal: request.signal,
      path: relative.path,
      basePath: relative.basePath,
      ...(live !== undefined && {
        serveStream: (frames, options) => serveSseStream(call, frames, { live, ...options }),
      }),
    });
  // The stream gate is the host's: a request its route counts as a stream passed the stream origin
  // check and holds a stream slot until the body ends; a route that streams without it is refused.
  if (streams) {
    state.stream = true;
    return withStreamSlot(call, run);
  }
  const response = await run();
  if (isStreamResponse(response)) {
    void response.body?.cancel().catch(() => undefined);
    return errorResponse(
      host,
      state,
      coreError('core.internal', {
        message: 'A route answered a stream to a request it did not count as one.',
      }),
    );
  }
  return response;
}

async function open(
  host: HostContext,
  carrier: Carrier,
  signal: AbortSignal,
): Promise<{ session: InvocationSession } | { error: KeelwerkError }> {
  const enriched = enrichCarrier(host, carrier);
  try {
    const opened = await host.deps.invoker.open(enriched, { signal });
    return opened.ok ? { session: opened.value } : { error: opened.error };
  } catch (failure) {
    return { error: asKeelwerkError(failure) };
  }
}

/**
 * The second step of the dispatch of section 16.3.3: read the body within the limit, fill the
 * carrier, let the enrichers name a scope key, open the session, apply the origin rules, then
 * serve the invocation protocol or the longest-prefix mount of the session's app.
 */
export async function serveRequest(
  host: HostContext,
  request: Request,
  bindings: HostBindings,
): Promise<Response> {
  const { state } = bindings;
  // Before the session opens only the path says whether a REST mount of any app answers: its
  // errors are problem documents from the first byte, the session's own app refines this below.
  const restPath = new URL(request.url).pathname;
  const earlyReserved = restPath === reservedPrefix || restPath.startsWith(`${reservedPrefix}/`);
  for (const table of host.mounts.values()) {
    const early = table.match(restPath);
    if (!earlyReserved && early?.transport === 'rest') {
      state.problemBase = `${new URL(request.url).origin}${early.prefix === '/' ? '' : early.prefix}`;
      break;
    }
  }
  // A ticket is a credential in a URL: under `/_keelwerk/` it is refused before anything is read
  // wherever it may not be one, and never reaches another endpoint. A well-formed one on any request
  // but the one that carries it is spent at once, so a ticket that a wrong request left in a log is
  // dead; on a mounted path the request then goes on as if the member were not a ticket.
  const requestUrl = new URL(request.url);
  const refusedTicket = ticketRefusal(request, requestUrl);
  const facts = socketFacts(host, request, bindings);
  if (refusedTicket !== null || !carriesTicket(request, requestUrl)) {
    await spendRefusedTickets(request, requestUrl, facts, (carrier) =>
      open(host, carrier, request.signal),
    );
  }
  if (refusedTicket !== null) return errorResponse(host, state, refusedTicket);
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array();
  try {
    if (!bodyless.has(request.method)) {
      bytes = await bodyLimit(request, host.maxBodyBytes);
    }
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const carrier = fillCarrier(request, facts);
  state.carrier = carrier;
  const opened = await open(host, carrier, request.signal);
  if ('error' in opened) {
    // A ticket refused on the one request that carries it is spent as well, with its binding not
    // checked, so a ticket offered for another subscription is dead for its own. Only the refusal
    // of the ticket itself spends: scope, version, rate and availability failures never judge it.
    if (carriesTicket(request, requestUrl) && opened.error.code === 'core.ticket_invalid') {
      await spendRefusedTickets(request, requestUrl, facts, (spent) =>
        open(host, spent, request.signal),
      );
    }
    return errorResponse(host, state, opened.error);
  }
  const { session } = opened;
  state.session = session;
  const headers = carrier.headers ?? {};
  const { pathname } = new URL(request.url);
  const reserved = pathname === reservedPrefix || pathname.startsWith(`${reservedPrefix}/`);
  // The route first: the invocation protocol allows the tenant's domains only, a mount adds its own `cors`.
  const matched = reserved ? undefined : host.mounts.get(session.app)?.match(pathname);
  const transport = matched?.transport;
  if (transport === 'rest' && matched !== undefined) {
    state.problemBase = `${new URL(request.url).origin}${matched.prefix === '/' ? '' : matched.prefix}`;
  } else {
    delete state.problemBase;
  }
  const allowed = host.deps.allowedOrigins?.(session, transport) ?? [];
  const plain = new URL(request.url).protocol === 'http:';
  if (
    headers.origin !== undefined &&
    isAllowedOrigin(headers.origin, headers.host, allowed, plain)
  ) {
    state.corsOrigin = headers.origin;
  }
  if (request.method === 'OPTIONS' && headers['access-control-request-method'] !== undefined) {
    return new Response(null, { status: 204 });
  }
  // The route's predicate decides once per request; its answer feeds the origin check and the stream slot.
  const routeStreams =
    matched === undefined
      ? undefined
      : (matched.streams ?? asksForEventStream)(
          request,
          mountPathOf(matched.prefix, pathname).path,
        );
  const csrf = originCheck(
    request.method,
    carrier,
    allowed,
    plain,
    isStreamRequest(request, pathname, routeStreams),
  );
  if (csrf !== null) {
    return errorResponse(host, state, csrf);
  }
  const call: EndpointCall = {
    host,
    state,
    session,
    carrier,
    request,
    ...(transport !== undefined && { transport }),
    bytes,
    ...(bindings.incoming !== undefined && { incoming: bindings.incoming }),
  };
  try {
    if (bindings.upgrade !== undefined) {
      return await dispatchUpgrade(call, pathname, bindings.upgrade);
    }
    if (pathname === protocolBase || pathname.startsWith(`${protocolBase}/`)) {
      return await protocolEndpoint(call, pathname);
    }
    if (reserved) {
      return errorResponse(
        host,
        state,
        coreError('core.not_found', { message: 'There is no such endpoint.' }),
      );
    }
    return await mounted(call, pathname, routeStreams === true);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
}
