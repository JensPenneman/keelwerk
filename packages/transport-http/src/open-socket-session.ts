import {
  type Carrier,
  type InvocationSession,
  type KeelwerkError,
  type LiveClientMessage,
  unknownClientAddress,
} from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { enrichCarrier } from './enrich-carrier.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { originCheck } from './origin-check.ts';
import { takeStreamSlot } from './take-stream-slot.ts';
import { versionConflictOf } from './version-conflict-of.ts';

function socketClosed(): KeelwerkError {
  return coreError('core.unavailable', { message: 'The socket is closed.', retryable: false });
}

/**
 * Gives the upgrade's place back and takes the slot of the session the socket now has: a socket that
 * said no more than an anonymous hello takes the anonymous bounds here, not at the upgrade. A take
 * past a bound refuses the hello. The take can wait on a control write; the socket's cleanup has
 * run by then and found no slot to give back, so a slot taken after the signal aborted is given back.
 */
async function settled(
  state: LiveSocketState,
  session: InvocationSession,
  carrier: Carrier,
  signal: AbortSignal = AbortSignal.any([state.everything.signal, state.open.connection.signal]),
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: KeelwerkError }> {
  const address = carrier.connection?.remote.address ?? unknownClientAddress;
  state.release();
  state.release = () => undefined;
  try {
    const release = await takeStreamSlot(state.upgrade.host, session, address);
    if (signal.aborted) {
      release();
      return { ok: false, error: socketClosed() };
    }
    state.release = release;
    state.session = session;
    state.socketCarrier = carrier;
    return { ok: true };
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}

/**
 * The session a hello asks for. A hello that names none of a token, a backend, a tenant and an API
 * version keeps the upgrade's session (an anonymous one takes its slot now, see `settled`). A hello whose API version differs from the one the upgrade
 * named (header or query parameter) is refused `core.validation`. Otherwise a new carrier is the upgrade's with the three
 * selector headers from the hello, and with the token set and the cookie and authorization headers
 * dropped when the hello brings one (one credential per session, as a stream ticket is). The invoker
 * opens it, a cookie session meets the origin rule of the tenant it now belongs to and of the
 * route's transport (the rule the upgrade met), and the slot of the upgrade is released before the
 * new session's is taken, so one socket never counts twice; a take past a bound refuses the hello
 * and the socket closes. The open hangs on the connection's signal: a client that leaves while it
 * runs, or while its slot is taken, aborts it: a session that opens after that is dropped and its
 * slot given back.
 */
export async function openSocketSession(
  state: LiveSocketState,
  hello: Extract<LiveClientMessage, { type: 'hello' }>,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: KeelwerkError }> {
  const { host, carrier: upgraded, request } = state.upgrade;
  if (
    hello.token === undefined &&
    hello.backend === undefined &&
    hello.tenant === undefined &&
    hello.apiVersion === undefined
  ) {
    return state.session.principal.kind === 'anonymous'
      ? settled(state, state.session, upgraded)
      : { ok: true };
  }
  const upgradeVersion = upgraded.headers?.['keelwerk-version'];
  if (
    hello.apiVersion !== undefined &&
    upgradeVersion !== undefined &&
    upgradeVersion !== hello.apiVersion
  ) {
    return { ok: false, error: versionConflictOf([upgradeVersion, hello.apiVersion]) };
  }
  const headers: Record<string, string> = { ...upgraded.headers };
  if (hello.backend !== undefined) headers['x-keelwerk-backend'] = hello.backend;
  if (hello.tenant !== undefined) headers['x-keelwerk-tenant'] = hello.tenant;
  if (hello.apiVersion !== undefined) headers['keelwerk-version'] = hello.apiVersion;
  if (hello.token !== undefined) {
    delete headers.cookie;
    delete headers.authorization;
  }
  const { token: _upgradeToken, ...rest }: Carrier = upgraded;
  const carrier: Carrier = {
    ...rest,
    headers,
    ...(hello.token !== undefined && { token: hello.token }),
    ...(hello.token === undefined && upgraded.token !== undefined && { token: upgraded.token }),
  };
  // The receive loop waits on this open, so only the connection can end it: a client that leaves, or a host that stops, aborts it.
  const signal = AbortSignal.any([state.everything.signal, state.open.connection.signal]);
  try {
    const opened = await host.deps.invoker.open(enrichCarrier(host, carrier), { signal });
    if (signal.aborted) return { ok: false, error: socketClosed() };
    if (!opened.ok) return { ok: false, error: opened.error };
    const session = opened.value;
    const plain = new URL(request.url).protocol === 'http:';
    const refused = originCheck(
      'GET',
      carrier,
      host.deps.allowedOrigins?.(session, state.upgrade.transport) ?? [],
      plain,
      true,
    );
    if (refused !== null) return { ok: false, error: refused };
    return await settled(state, session, carrier, signal);
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}
