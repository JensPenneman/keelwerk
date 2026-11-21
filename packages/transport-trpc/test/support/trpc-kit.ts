import {
  type ApiSurface,
  deriveSurface,
  type HttpContext,
  type HttpHandler,
  type Invocation,
  type InvocationSession,
  type Invoker,
  type LiveFrame,
  type MountContext,
  type Outcome,
  renderTypeId,
  type StateToken,
  type Telemetry,
  type TransportHost,
  type VersionProjection,
  type WebSocketHandler,
} from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { createTrpcAdapter } from '../../src/create-trpc-adapter.ts';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import type { TrpcConfig } from '../../src/trpc-config.ts';
import type { TrpcStaticOptions } from '../../src/trpc-static-options.ts';
import { trpcConformanceApp, trpcConformanceVersions } from './trpc-conformance-app.ts';

type Respond = (inv: Invocation<unknown>) => Outcome<unknown> | Promise<Outcome<unknown>>;

export const trpcRequestId = '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11';

/** An invocation session at an API version, anonymous unless `over` says otherwise. */
export function trpcSession(over: Partial<InvocationSession> = {}): InvocationSession {
  return {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    app: 'trpc-conformance',
    principal: {
      kind: 'anonymous',
      scope: { backend: null, tenant: null },
      claims: {},
      roles: [],
      memberships: [],
      via: 'none',
      ref: null,
    },
    apiVersion: trpcConformanceVersions.head,
    deprecation: null,
    resolvedBy: 'hostname',
    revalidate: async () => ({ ok: true, value: trpcSession(over) }),
    ...over,
  };
}

/** The surface of the conformance app (live, library, loans and tRPC composed) at an API version. */
export function trpcConformanceSurface(
  apiVersion: string = trpcConformanceVersions.head,
): ApiSurface {
  return deriveSurface(trpcConformanceApp as never, apiVersion).surface;
}

/** The surface with the members of one action replaced (a hint, an input, an output). */
export function trpcSurfaceWith(
  surface: ApiSurface,
  over: Record<string, unknown>,
  ref: string,
): ApiSurface {
  return {
    ...surface,
    actions: surface.actions.map((candidate) =>
      candidate.ref === ref ? ({ ...candidate, ...over } as typeof candidate) : candidate,
    ),
  };
}

/** The action of a surface by its ref; throws when the surface has none. */
export function findTrpcAction(surface: ApiSurface, ref: string): ApiSurface['actions'][number] {
  const found = surface.actions.find((candidate) => candidate.ref === ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}

/** What a fake invoker's `subscribe` yields for an invocation. */
export type TrpcSubscribe = (
  inv: Invocation<unknown>,
  resume: { readonly after: StateToken } | undefined,
) => AsyncIterable<LiveFrame<unknown>>;

/** What the adapter registered through `host.route`. */
export interface TrpcRegistered {
  readonly prefix: string;
  readonly handler: HttpHandler;
  readonly streams: ((request: Request, path: string) => boolean) | undefined;
}

/** What the adapter registered through `host.upgrade`. */
export interface TrpcUpgraded {
  readonly path: string;
  readonly protocols: readonly string[];
  readonly handler: WebSocketHandler;
}

export interface TrpcMounted {
  readonly handler: HttpHandler;
  readonly registered: TrpcRegistered[];
  readonly upgraded: TrpcUpgraded[];
  readonly calls: Invocation<unknown>[];
  readonly subscribed: Invocation<unknown>[];
  readonly lines: LoggedLine[];
  readonly close: (deadline?: AbortSignal) => Promise<void>;
}

export interface TrpcMountOptions {
  readonly config?: Partial<TrpcConfig>;
  readonly development?: boolean;
  readonly options?: TrpcStaticOptions;
  /** What the invoker's `subscribe` yields; absent, a subscription throws. */
  readonly subscribe?: TrpcSubscribe;
  /** The surface of each declared API version; absent, `surface` serves every version. */
  readonly surfaces?: VersionProjection<ApiSurface>;
}

/** Mounts the tRPC adapter on a fake host the way the runtime does and hands back the registered handler. */
export async function mountedTrpc(
  surface: ApiSurface,
  respond: Respond,
  over: TrpcMountOptions = {},
): Promise<TrpcMounted> {
  const registered: TrpcRegistered[] = [];
  const upgraded: TrpcUpgraded[] = [];
  const host: TransportHost = {
    route: (spec, handler) => {
      registered.push({ prefix: spec.prefix, handler, streams: spec.streams });
    },
    upgrade: (spec, handler) => {
      upgraded.push({ path: spec.path, protocols: spec.protocols, handler });
    },
    fetch: async () => new Response(null, { status: 404 }),
  };
  const calls: Invocation<unknown>[] = [];
  const subscribed: Invocation<unknown>[] = [];
  const invoker: Invoker = {
    open: async () => ({ ok: true, value: trpcSession() }),
    invoke: async <I, O>(inv: Invocation<I>) => {
      calls.push(inv);
      return (await respond(inv)) as Outcome<O>;
    },
    subscribe: <I, E>(inv: Invocation<I>, resume?: { readonly after: StateToken }) => {
      subscribed.push(inv as Invocation<unknown>);
      if (over.subscribe === undefined) throw new Error('this test serves no subscriptions');
      return over.subscribe(inv as Invocation<unknown>, resume) as AsyncIterable<LiveFrame<E>>;
    },
  };
  const lines: LoggedLine[] = [];
  const context: MountContext<TrpcConfig> = {
    app: surface.app,
    deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
    surface,
    invoker,
    host,
    config: () => ({ cors: [], maxBodyBytes: 1_048_576, websocket: false, ...over.config }),
    telemetry: {} as unknown as Telemetry,
    log: recordingLogger(lines),
    ...(over.development === true ? { development: true } : {}),
    ...(over.surfaces === undefined ? {} : { surfaces: over.surfaces }),
  };
  const handle = await createTrpcAdapter(over.options ?? {}).mount(context);
  const first = registered[0];
  if (first === undefined) throw new Error('the adapter registered no route');
  return {
    handler: first.handler,
    registered,
    upgraded,
    calls,
    subscribed,
    lines,
    close: (deadline = new AbortController().signal) => handle.close(deadline),
  };
}

export interface TrpcCallOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  /** The query string without the leading `?`. */
  readonly search?: string;
  /** The body, as text. */
  readonly rawBody?: string;
  readonly session?: InvocationSession;
  readonly signal?: AbortSignal;
  /** The headers of the carrier the transport handed the invoker. */
  readonly carrierHeaders?: Record<string, string>;
}

/** One request for a procedure path (`library.book.get`, or `a,b` of a batch) through the handler, as the host would pass it. */
export async function sendTrpc(
  handler: HttpHandler,
  path: string,
  options: TrpcCallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  const method = options.method ?? 'GET';
  if (options.rawBody !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const query = options.search === undefined ? '' : `?${options.search}`;
  const request = new Request(`https://portal.example/trpc/${path}${query}`, {
    method,
    headers,
    ...(options.rawBody === undefined ? {} : { body: options.rawBody }),
  });
  const context: HttpContext = {
    session: options.session ?? trpcSession(),
    carrier: {
      transport: 'http',
      host: 'portal.example',
      path: `/trpc/${path}`,
      headers: options.carrierHeaders ?? {},
    },
    requestId: trpcRequestId,
    signal: options.signal ?? new AbortController().signal,
    path: `/${path}`,
    basePath: '/trpc',
  };
  return await handler(request, context);
}

/** The superjson envelope of a value, as a client's transformer writes it. */
export function envelope(value: unknown): unknown {
  return keelwerkSuperjson().serialize(value as never);
}

/** What `JSON.parse` answers: the tests read the parsed answer by path. */
export type TrpcParsed = ReturnType<typeof JSON.parse>;

export interface TrpcAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: TrpcParsed;
}

/** A query through the handler (GET with `?input=`), the answer parsed. */
export async function queryTrpc(
  handler: HttpHandler,
  path: string,
  input?: unknown,
  options: TrpcCallOptions = {},
): Promise<TrpcAnswer> {
  const search =
    input === undefined ? '' : `input=${encodeURIComponent(JSON.stringify(envelope(input)))}`;
  return await readTrpcAnswer(await sendTrpc(handler, path, { ...options, search }));
}

/** A command through the handler (POST with the envelope as the body), the answer parsed. */
export async function mutateTrpc(
  handler: HttpHandler,
  path: string,
  input?: unknown,
  options: TrpcCallOptions = {},
): Promise<TrpcAnswer> {
  return await readTrpcAnswer(
    await sendTrpc(handler, path, {
      ...options,
      method: 'POST',
      rawBody: JSON.stringify(envelope(input)),
    }),
  );
}

/** The parsed answer of a response. */
export async function readTrpcAnswer(response: Response): Promise<TrpcAnswer> {
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? {} : JSON.parse(text),
  };
}

/** The deterministic UUID of the n-th row of a test. */
export function trpcUuidOf(n: number): string {
  return `0198a1e0-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

/** The public id of the n-th row of an entity. */
export function trpcPublicId(prefix: string, n: number): string {
  return renderTypeId(prefix, trpcUuidOf(n));
}
