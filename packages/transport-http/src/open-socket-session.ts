import type { Carrier, KeelwerkError, LiveClientMessage } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { enrichCarrier } from './enrich-carrier.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { originCheck } from './origin-check.ts';

/**
 * The session a hello asks for. A hello that names none of a token, a backend, a tenant and an API
 * version keeps the upgrade's session. Otherwise a new carrier is the upgrade's with the three
 * selector headers from the hello, and with the token set and the cookie and authorization headers
 * dropped when the hello brings one (one credential per session, as a stream ticket is). The invoker
 * opens it, a cookie session meets the origin rule of the tenant it now belongs to, and the slot of the
 * upgrade is released before the new session's is taken, so one socket never counts twice; a take past
 * a bound refuses the hello and the socket closes. The open hangs on the connection's signal: a client
 * that leaves while it runs aborts it, and a session that opens after that is dropped.
 */
export async function openSocketSession(
  state: LiveSocketState,
  hello: Extract<LiveClientMessage, { type: 'hello' }>,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: KeelwerkError }> {
  if (
    hello.token === undefined &&
    hello.backend === undefined &&
    hello.tenant === undefined &&
    hello.apiVersion === undefined
  ) {
    return { ok: true };
  }
  const { host, carrier: upgraded, request } = state.upgrade;
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
    if (signal.aborted) {
      return {
        ok: false,
        error: coreError('core.unavailable', {
          message: 'The socket is closed.',
          retryable: false,
        }),
      };
    }
    if (!opened.ok) return { ok: false, error: opened.error };
    const session = opened.value;
    const plain = new URL(request.url).protocol === 'http:';
    const refused = originCheck(
      'GET',
      carrier,
      host.deps.allowedOrigins?.(session) ?? [],
      plain,
      true,
    );
    if (refused !== null) return { ok: false, error: refused };
    // The upgrade's slot goes first, so one socket never counts twice against a bound.
    const address = carrier.connection?.remote.address ?? 'unknown';
    state.release();
    state.release = () => undefined;
    state.release = host.limits.take(session, address);
    state.session = session;
    state.socketCarrier = carrier;
    return { ok: true };
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}
