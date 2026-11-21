import type { WebSocketHandler } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { getWSConnectionHandler } from '@trpc/server/adapters/ws';
import { trpcErrorLogger } from '../mount/trpc-error-logger.ts';
import type { TrpcHandlerDeps } from '../mount/trpc-handler-deps.ts';
import { trpcConnectionParamsOf } from './trpc-connection-params-of.ts';
import { trpcSocketContext } from './trpc-socket-context.ts';
import { trpcWsBridgeOf } from './trpc-ws-bridge-of.ts';

type WsOptions = Parameters<typeof getWSConnectionHandler>[0];
type WsClient = Parameters<ReturnType<typeof getWSConnectionHandler>>[0];
type WsRequest = Parameters<ReturnType<typeof getWSConnectionHandler>>[1];

/**
 * The `keelwerk.trpc.v1` endpoint of a backend (section 16.7.5): tRPC's own connection handler over
 * the web socket the host hands over, so the host's one set of protections holds (origin check,
 * retired versions, the anonymous cap, the subscription slots, the session check, the maximum
 * duration, the ping bounds); nothing of them is written here. A backend without `websocket` answers
 * 404 before the handshake. With `connectionParams=1` in the URL the first message holds the credentials
 * (`token`, `tenant`, `backend`, `apiVersion`), read once and never kept; without it the session of the
 * upgrade is kept. The router is the one of the opened session's API version. Only queries and
 * subscriptions run here, each after the host's session check (`admitSocketCall`); a command and an action with a
 * cookie hint are refused `core.unsupported` (a command needs the command id, `Prefer` and effects headers of HTTP and is
 * the call that writes a decision record, which core builds only for commands and reactions, so no call over the socket
 * writes one). A message is bounded by the
 * backend's body limit and the queries running at once by the host's call slots (`SocketSession.invocation`,
 * `maxPendingInvokes`). A socket that fails ends as the host's own do: a malformed first message closes it
 * 4000 `protocol_error`, an internal failure 1011 `internal_error`.
 */
export function trpcWsHandler(deps: TrpcHandlerDeps): WebSocketHandler {
  return {
    refuse: (ctx) =>
      deps.config(ctx.session.scope).websocket
        ? undefined
        : coreError('core.not_found', { message: 'There is no such endpoint.' }),
    open(socket, ctx, connection) {
      let limit = (): number => deps.config(ctx.session.scope).maxBodyBytes;
      const bridge = trpcWsBridgeOf(socket, () => limit(), connection.maxMessageBytes);
      const serve = async (): Promise<void> => {
        let credentials: Parameters<typeof connection.open>[0] = {};
        if (new URL(socket.url).searchParams.get('connectionParams') === '1') {
          const text = await bridge.first();
          if (text === undefined) return;
          const parsed = trpcConnectionParamsOf(text);
          if (parsed === undefined) {
            socket.close(4000, 'protocol_error');
            return;
          }
          credentials = parsed;
        }
        const opened = await connection.open(credentials);
        if (!opened.ok) return;
        limit = () => deps.config(connection.session().scope).maxBodyBytes;
        const mount = deps.versions.at(connection.session().apiVersion);
        const options: Omit<WsOptions, 'wss'> = {
          router: mount.router,
          createContext: () => trpcSocketContext(deps, mount, ctx, connection),
          maxBatchSize: 20,
          onError: trpcErrorLogger(deps.log, ctx.requestId),
        };
        getWSConnectionHandler(options as WsOptions)(
          bridge.client as unknown as WsClient,
          { url: '/', headers: {} } as unknown as WsRequest,
        );
        bridge.attach();
      };
      serve().catch((thrown: unknown) => {
        deps.log.error('The tRPC socket failed.', {
          requestId: ctx.requestId,
          code: asKeelwerkError(thrown).code,
        });
        socket.close(1011, 'internal_error');
      });
    },
  };
}
