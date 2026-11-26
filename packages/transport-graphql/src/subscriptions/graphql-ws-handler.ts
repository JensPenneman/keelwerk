import type { KeelwerkError, WebSocketHandler } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { type ExecutionArgs, type ExecutionResult, getOperationAST, subscribe } from 'graphql';
import { makeServer } from 'graphql-ws';
import { graphqlAnswerOf } from '../errors/graphql-answer-of.ts';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import type { GraphqlHandlerDeps } from '../mount/graphql-handler-deps.ts';
import { graphqlParamsOf } from '../request/graphql-params-of.ts';
import { prepareDocuments } from '../request/prepare-documents.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlContextOf } from '../resolve/graphql-context-of.ts';
import { graphqlWsSocketOf } from './graphql-ws-socket-of.ts';

/** The members of `connectionParams` that are credentials, as the hello of `keelwerk.live.v1` names them. */
const credentialNames = ['token', 'tenant', 'backend', 'apiVersion'] as const;

/** The credentials of the connection parameters, or `undefined` when one is not a string. Other members are ignored. */
function credentialsOf(
  params: unknown,
): Partial<Record<(typeof credentialNames)[number], string>> | undefined {
  const credentials: Partial<Record<(typeof credentialNames)[number], string>> = {};
  if (typeof params !== 'object' || params === null) return credentials;
  for (const name of credentialNames) {
    const value: unknown = Reflect.get(params, name);
    if (value === undefined) continue;
    if (typeof value !== 'string') return undefined;
    credentials[name] = value;
  }
  return credentials;
}

/** Each result of a subscription as a caller sees it (`graphqlAnswerOf`); a stream stays a stream, its `return` reaching the source. */
function answered(
  result: ExecutionResult | AsyncGenerator<ExecutionResult, void, void>,
  context: GraphqlContext,
): ExecutionResult | AsyncGenerator<ExecutionResult, void, void> {
  if (!(Symbol.asyncIterator in result)) return graphqlAnswerOf(result, context);
  const source = result;
  const mapped: AsyncGenerator<ExecutionResult, void, void> = {
    async next() {
      const step = await source.next();
      return step.done === true
        ? step
        : { done: false, value: graphqlAnswerOf(step.value, context) };
    },
    return: (value) => source.return(value),
    throw: (failure: unknown) => source.throw(failure),
    [Symbol.asyncIterator]() {
      return mapped;
    },
    [Symbol.asyncDispose]: () => source[Symbol.asyncDispose](),
  };
  return mapped;
}

/**
 * The `graphql-transport-ws` endpoint of a backend (section 16.6.5): graphql-ws's `makeServer` on the
 * web socket the host hands over, so the host's one set of protections holds: the origin check and
 * the retired-version check at the upgrade, the anonymous cap per address, the subscription slots,
 * the session check, the maximum duration and the ping bounds. Nothing of them is written here. A
 * backend without `websocket` answers 404 before the handshake. The credentials are the
 * `connectionParams` (`token`, `tenant`, `backend`, `apiVersion`), read once at `connection_init`
 * and never kept; the host waits for `connection_init` (its first-message wait), so the library's own
 * timer is off. Only subscription operations run here; queries and mutations go over HTTP. A
 * subscription over the limits of the gate is an `error` message on its id and reaches no invoker.
 */
export function graphqlWsHandler(deps: GraphqlHandlerDeps): WebSocketHandler {
  return {
    refuse: (ctx) =>
      deps.config(ctx.session.scope).websocket
        ? undefined
        : coreError('core.not_found', { message: 'There is no such endpoint.' }),
    open(socket, ctx, connection) {
      const slots = new Map<string, { release(): void }>();
      const release = (id: string): void => {
        slots.get(id)?.release();
        slots.delete(id);
      };
      const refusal = (error: KeelwerkError) =>
        graphqlErrorOf(error, {
          session: connection.session(),
          development: deps.development,
          requestId: ctx.requestId,
          logger: deps.log,
        });
      const server = makeServer({
        connectionInitWaitTimeout: 0,
        onConnect: async (held) => {
          const params = held.connectionParams;
          Reflect.deleteProperty(held, 'connectionParams');
          const credentials = credentialsOf(params);
          if (credentials === undefined) {
            socket.close(4400, 'Invalid connection parameters');
            return false;
          }
          const opened = await connection.open(credentials);
          return opened.ok;
        },
        onSubscribe: async (_held, id, payload) => {
          let documents: ReturnType<typeof prepareDocuments> | undefined;
          try {
            // The host's session check first: a session that no longer holds starts nothing, and the check has closed the socket.
            if (!(await connection.check())) {
              throw coreError('core.unavailable', { message: 'The session is no longer valid.' });
            }
            const mount = deps.versions.at(connection.session().apiVersion);
            const params = graphqlParamsOf(payload);
            documents = prepareDocuments([params], mount.projection, deps.limits);
            const document = documents.get(params.query);
            const operation =
              document === undefined ? null : getOperationAST(document, params.operationName);
            if (document === undefined || operation === null || operation === undefined) {
              throw coreError('core.validation', { message: 'Name the operation to run.' });
            }
            if (operation.operation !== 'subscription') {
              throw coreError('core.unsupported', {
                message: 'Send queries and mutations over HTTP.',
              });
            }
            const slot = connection.subscription(id);
            slots.set(id, slot);
            const args: ExecutionArgs = {
              schema: mount.projection.schema,
              document,
              ...(params.operationName === undefined
                ? {}
                : { operationName: params.operationName }),
              ...(params.variables === undefined ? {} : { variableValues: params.variables }),
              contextValue: graphqlContextOf(
                deps,
                mount,
                {
                  session: connection.session(),
                  carrier: connection.carrier(),
                  requestId: ctx.requestId,
                  ...(ctx.traceparent === undefined ? {} : { traceparent: ctx.traceparent }),
                  signal: slot.signal,
                },
                documents,
                connection,
              ),
            };
            return args;
          } catch (thrown) {
            return [refusal(asKeelwerkError(thrown))];
          }
        },
        subscribe: async (args) => {
          const result = await subscribe(args);
          return answered(result, args.contextValue as GraphqlContext);
        },
        onComplete: (_held, id) => {
          release(id);
        },
        onError: (_held, id) => {
          release(id);
        },
      });
      const closed = server.opened(graphqlWsSocketOf(socket), undefined);
      socket.addEventListener('close', (event) => {
        for (const id of [...slots.keys()]) release(id);
        const { code, reason } = event as CloseEvent;
        void closed(code, reason);
      });
    },
  };
}
