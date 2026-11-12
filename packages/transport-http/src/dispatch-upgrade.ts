import { coreError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import type { PendingUpgrade } from './pending-upgrade.ts';
import { upgradeTable } from './upgrade-table.ts';

/** Subprotocol names read from one upgrade; a client offering more is not speaking a protocol of ours. */
const maxOffered = 16;
/** A `token` of RFC 6455 section 4.1 (RFC 9110 section 5.6.2). */
const protocolName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** The names offered, or why the header is refused: a name outside the token grammar, a name twice, too many. */
function offeredBy(header: string | null): string[] | string {
  if (header === null || header.trim() === '') return [];
  const names = header.split(',').map((name) => name.trim());
  if (names.length > maxOffered) return 'Too many subprotocols offered.';
  if (!names.every((name) => protocolName.test(name))) return 'A subprotocol is not a valid token.';
  if (new Set(names).size !== names.length) return 'A subprotocol is offered twice.';
  return names;
}

/**
 * The one dispatch over the upgrade table (16.3.3): refuses a non-GET or a non-websocket upgrade
 * (`core.unsupported`); a fixed-path entry whose protocol the client offers wins, then a
 * registration of the session's app for the path and an offered protocol with a path-less entry; a
 * known path without an offered protocol is `core.unsupported`, anything else `core.not_found`.
 * Accepted: sets `state.upgraded` and answers 204, which is never sent.
 */
export async function dispatchUpgrade(
  call: EndpointCall,
  pathname: string,
  upgrade: PendingUpgrade,
): Promise<Response> {
  const { host, state, request, session } = call;
  const refuse = (error: ReturnType<typeof coreError>): Response =>
    errorResponse(host, state, error);
  const asked = (request.headers.get('upgrade') ?? '')
    .split(',')
    .some((token) => token.trim().toLowerCase() === 'websocket');
  if (request.method !== 'GET' || !asked) {
    return refuse(
      coreError('core.unsupported', { message: 'This endpoint upgrades to a WebSocket only.' }),
    );
  }
  const offered = offeredBy(request.headers.get('sec-websocket-protocol'));
  if (typeof offered === 'string') {
    return refuse(
      coreError('core.malformed_request', {
        issues: [{ path: ['sec-websocket-protocol'], message: offered }],
      }),
    );
  }
  const registrations = host.upgrades.get(session.app) ?? [];
  const entry = upgradeTable.find(
    (candidate) => candidate.path === pathname && offered.includes(candidate.protocol),
  );
  let refusal: Response | null | undefined;
  if (entry !== undefined) {
    state.route = pathname;
    refusal = await entry.serve(call, upgrade);
  } else {
    const registered = registrations.find(
      (candidate) =>
        candidate.path === pathname &&
        candidate.protocols.some((protocol) => offered.includes(protocol)),
    );
    const protocol = registered?.protocols.find((name) => offered.includes(name));
    const served =
      registered === undefined
        ? undefined
        : upgradeTable.find(
            (candidate) => candidate.path === undefined && candidate.protocol === protocol,
          );
    if (registered !== undefined && served !== undefined) {
      state.route = pathname;
      refusal = await served.serve(call, upgrade, registered);
    } else {
      const known =
        upgradeTable.some((candidate) => candidate.path === pathname) ||
        registrations.some((candidate) => candidate.path === pathname);
      return refuse(
        known
          ? coreError('core.unsupported', { message: 'Offer a subprotocol this endpoint serves.' })
          : coreError('core.not_found', { message: 'There is no such endpoint.' }),
      );
    }
  }
  if (refusal !== null && refusal !== undefined) return refusal;
  state.upgraded = true;
  return new Response(null, { status: 204 });
}
