import { contracts, defineTransportModule } from '@keelwerk/core';
import { asKeelwerkError, statusOfError } from '@keelwerk/core/http';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A fourth transport for the harness tests, mounted at `/fake` through `ctx.host.route` like any
 * transport: `POST /fake/<action>` invokes the action with the JSON body as input (carrier and
 * session from the host, transport 'fake') and answers `{ ok, value }` or `{ ok: false, error: { code } }`
 * with `statusOfError`; `GET /fake/address` answers `{ address }`, the carrier's
 * `connection.remote.address`.
 */
export const fakeTransport = defineTransportModule({
  id: 'fake',
  requires: [contracts.httpHost],
  transport: {
    name: 'fake',
    capabilities: { streaming: [], batching: false, binary: false },
    static: undefined,
    check: () => [],
    artifacts: () => [],
    mount: async (ctx) => {
      ctx.host.route(
        { app: ctx.app, transport: 'fake', prefix: '/fake' },
        async (request, http) => {
          if (request.method === 'GET' && http.path === '/address') {
            return json(200, { address: http.carrier.connection?.remote.address });
          }
          const action = http.path.replace(/^\//, '');
          try {
            const input: unknown = await request.json();
            const outcome = await ctx.invoker.invoke({
              action,
              input,
              carrier: { ...http.carrier, transport: 'fake' },
              session: http.session,
              requestId: http.requestId,
              signal: http.signal,
            });
            if (outcome.ok) return json(200, { ok: true, value: outcome.value });
            return json(statusOfError(outcome.error), {
              ok: false,
              error: { code: outcome.error.code },
            });
          } catch (thrown) {
            const error = asKeelwerkError(thrown);
            return json(statusOfError(error), { ok: false, error: { code: error.code } });
          }
        },
      );
      return { close: async () => undefined };
    },
  },
});
