import {
  pinnedTransportClock,
  requestHeaders,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { EventSource } from 'eventsource';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { trpcCodec } from './trpc-codec.ts';
import { trpcConformanceApp } from './trpc-conformance-app.ts';
import type { TrpcRouter } from './trpc-conformance-router.ts';

/** The conformance app served by the real host on a port, and the clients of `@trpc/client` that call it in-process. */
export async function trpcClientHost() {
  const clock = pinnedTransportClock(Temporal.Instant.from('2026-11-12T12:00:00Z'));
  const runtime = await startTransportRuntime({
    app: trpcConformanceApp,
    host: httpHost({
      listen: { port: 0 },
      trustedProxies: ['127.0.0.1'],
      live: { maxStreamsPerPrincipal: 2 },
    }),
    config: {},
    tenants: ['acme'],
    clock: clock.clock,
    timers: clock.timers,
  });
  const target = transportTargetOf(runtime, trpcCodec, [], true, clock.advance);
  const domain = target.tenants.acme?.domain ?? '';
  const url = `https://${domain}/trpc`;

  /** The host's own fetch, with the principal of the subject: a client in the test runs in-process. */
  function hostFetch(subject: string, more: Record<string, string> = {}) {
    return async (
      input: string | URL | Request,
      init?: RequestInit | undefined,
    ): Promise<Response> => {
      const request = new Request(input, init);
      for (const [name, value] of requestHeaders({ subject })) request.headers.set(name, value);
      for (const [name, value] of Object.entries(more)) request.headers.set(name, value);
      return await target.fetch(request);
    };
  }

  function clientOf(subject: string, more: Record<string, string> = {}) {
    return clientWith(hostFetch(subject, more));
  }

  function clientWith(fetchWith: ReturnType<typeof hostFetch>) {
    const transformer = keelwerkSuperjson();
    return createTRPCClient<TrpcRouter>({
      links: [
        splitLink({
          condition: (operation) => operation.type === 'subscription',
          true: httpSubscriptionLink({
            url,
            transformer,
            // biome-ignore lint/style/useNamingConvention: the option is tRPC's own name
            EventSource: EventSource as never,
            eventSourceOptions: () => ({ fetch: fetchWith }) as never,
          }),
          false: httpBatchLink({ url, transformer, fetch: fetchWith as never }),
        }),
      ],
    });
  }
  return { url, hostFetch, clientOf, clientWith, stop: () => runtime.stop() };
}
