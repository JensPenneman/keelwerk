import type {
  ApiSurface,
  HttpContext,
  LiveFrame,
  StateToken,
  VersionProjection,
} from '@keelwerk/core';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import type { TrpcStaticOptions } from '../../src/trpc-static-options.ts';
import { type FakeTrpcConnection, fakeTrpcConnection } from './fake-trpc-connection.ts';
import { FakeTrpcSocket, type SocketMessage } from './fake-trpc-socket.ts';
import {
  envelope,
  mountedTrpc,
  type TrpcMountOptions,
  type TrpcSubscribe,
  trpcConformanceSurface,
  trpcRequestId,
  trpcSession,
} from './trpc-kit.ts';

/** A stream that yields its head and then waits for the invocation to be aborted. */
const holding: TrpcSubscribe = (inv) =>
  (async function* (): AsyncGenerator<LiveFrame<unknown>> {
    yield { control: 'head', state: headState };
    await new Promise<void>((done) => {
      if (inv.signal.aborted) done();
      else inv.signal.addEventListener('abort', () => done(), { once: true });
    });
  })();

/** The limits of every wait in these tests, generous for a loaded machine. */
export const waitOptions = { timeout: 5_000, interval: 5 } as const;

export const httpContext: HttpContext = {
  session: trpcSession(),
  carrier: { transport: 'http', host: 'portal.example', path: '/trpc', headers: {} },
  requestId: trpcRequestId,
  signal: new AbortController().signal,
  path: '/',
  basePath: '/trpc',
};

export const headState = 'v2.1.1.scope.aaaa' as StateToken;
export const respond = () => ({ ok: true as const, value: {} });

export interface Setup {
  readonly socket: FakeTrpcSocket;
  readonly mounted: Awaited<ReturnType<typeof mountedTrpc>>;
  readonly held: FakeTrpcConnection;
}

/** The handler the adapter registers, mounted with `websocket` on and driven through a fake socket and a fake host session. */
export async function served(
  over: {
    readonly url?: string;
    readonly connection?: Parameters<typeof fakeTrpcConnection>[0];
    readonly surface?: ReturnType<typeof trpcConformanceSurface>;
    readonly subscribe?: TrpcSubscribe;
    readonly respond?: Parameters<typeof mountedTrpc>[1];
    readonly options?: TrpcStaticOptions;
    readonly surfaces?: VersionProjection<ApiSurface>;
    readonly config?: TrpcMountOptions['config'];
  } = {},
): Promise<Setup> {
  const mounted = await mountedTrpc(
    over.surface ?? trpcConformanceSurface(),
    over.respond ?? respond,
    {
      config: { websocket: true, ...over.config },
      ...(over.options === undefined ? {} : { options: over.options }),
      ...(over.surfaces === undefined ? {} : { surfaces: over.surfaces }),
      subscribe: over.subscribe ?? holding,
    },
  );
  const handler = mounted.upgraded[0]?.handler;
  if (handler === undefined) throw new Error('the adapter registered no upgrade');
  const socket = new FakeTrpcSocket(over.url);
  const held = fakeTrpcConnection(over.connection);
  handler.open(socket as unknown as WebSocket, httpContext, held.connection);
  return { socket, mounted, held };
}

/** The keelwerk error an error message carries. */
export function keelwerkOf(message: SocketMessage | undefined): Record<string, unknown> {
  const held: unknown = message?.error;
  const shape = (
    typeof held === 'object' && held !== null && 'json' in held
      ? keelwerkSuperjson().deserialize(held as never)
      : held
  ) as { data?: { keelwerk?: Record<string, unknown> } } | undefined;
  return shape?.data?.keelwerk ?? {};
}

/** One query call of the tRPC socket protocol, as text. */
export const queryMessage = (id: number, path = 'library.findByIsbn'): string =>
  JSON.stringify({ id, method: 'query', params: { path, input: envelope({ isbn: 'x' }) } });

/** One subscription call, as text. */
export const subscriptionMessage = (id: number, path = 'loans.loanTicker'): string =>
  JSON.stringify({ id, method: 'subscription', params: { path, input: envelope(undefined) } });
