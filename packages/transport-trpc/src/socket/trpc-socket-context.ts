import type { HttpContext, SocketSession } from '@keelwerk/core';
import type { TrpcHandlerDeps } from '../mount/trpc-handler-deps.ts';
import type { TrpcVersionMount } from '../mount/trpc-version-mount.ts';
import type { TrpcContext } from '../router/trpc-context.ts';

/**
 * The context of the calls of one socket: the session and the carrier are read from the host's
 * session at each call, since a revalidation replaces them; the surface is the one of the version the
 * opened session picked. A call over a socket has no command id, preference or cookie to set.
 */
export function trpcSocketContext(
  deps: TrpcHandlerDeps,
  mount: TrpcVersionMount,
  ctx: HttpContext,
  connection: SocketSession,
): TrpcContext {
  return {
    get session() {
      return connection.session();
    },
    get carrier() {
      return connection.carrier();
    },
    requestId: ctx.requestId,
    ...(ctx.traceparent === undefined ? {} : { traceparent: ctx.traceparent }),
    surface: mount.surface,
    invoker: deps.invoker,
    transformer: deps.transformer,
    development: deps.development,
    logger: deps.log,
    socket: connection,
    closing: deps.closing,
    running: deps.running,
    answer: { setCookies: [] },
  };
}
