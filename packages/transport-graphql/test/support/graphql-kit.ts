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
  type SelectionLimits,
  type StateToken,
  type Telemetry,
  type TransportHost,
  type VersionProjection,
  type WebSocketHandler,
} from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { createGraphqlAdapter } from '../../src/create-graphql-adapter.ts';
import type { GraphqlConfig } from '../../src/graphql-config.ts';
import { createGraphqlHandler } from '../../src/mount/create-graphql-handler.ts';
import { graphqlVersionMounts } from '../../src/mount/graphql-version-mounts.ts';
import { graphqlConformanceApp, graphqlConformanceVersions } from './graphql-conformance-app.ts';

export const graphqlRequestId = '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11';

/** An invocation session for a signed-in subject (or anonymous) at an API version. */
export function graphqlSession(over: Partial<InvocationSession> = {}): InvocationSession {
  const value: InvocationSession = {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    app: 'transport',
    principal: {
      kind: 'anonymous',
      scope: { backend: null, tenant: null },
      claims: {},
      roles: [],
      memberships: [],
      via: 'none',
      ref: null,
    },
    apiVersion: '2026-11-04',
    deprecation: null,
    resolvedBy: 'hostname',
    revalidate: async () => ({ ok: true, value: graphqlSession(over) }),
    ...over,
  };
  return value;
}

/** The surface of the transport fixture app (the library and loans modules) at an API version. */
export function transportSurface(apiVersion = '2026-11-04'): ApiSurface {
  return deriveSurface(transportApp as never, apiVersion).surface;
}

/** What a fake invoker's `subscribe` yields for an invocation. */
export type GraphqlSubscribe = (
  inv: Invocation<unknown>,
  resume: { readonly after: StateToken } | undefined,
) => AsyncIterable<LiveFrame<unknown>>;

export interface GraphqlFakeInvoker {
  readonly invoker: Invoker;
  readonly calls: Invocation<unknown>[];
  /** The invocations `subscribe` was asked for, in order. */
  readonly subscribed: Invocation<unknown>[];
}

/** The surface of the conformance app (live, library, loans and GraphQL composed) at an API version. */
export function conformanceSurface(
  apiVersion: string = graphqlConformanceVersions.head,
): ApiSurface {
  return deriveSurface(graphqlConformanceApp as never, apiVersion).surface;
}

/** An invoker that answers every invocation with `respond` and records it. */
export function graphqlInvoker(
  respond: (inv: Invocation<unknown>) => Outcome<unknown> | Promise<Outcome<unknown>>,
  subscribe?: GraphqlSubscribe,
): GraphqlFakeInvoker {
  const calls: Invocation<unknown>[] = [];
  const subscribed: Invocation<unknown>[] = [];
  const invoker: Invoker = {
    open: async () => ({ ok: true, value: graphqlSession() }),
    invoke: async <I, O>(inv: Invocation<I>) => {
      calls.push(inv);
      return (await respond(inv)) as Outcome<O>;
    },
    subscribe: <I, E>(inv: Invocation<I>, resume?: { readonly after: StateToken }) => {
      subscribed.push(inv as Invocation<unknown>);
      if (subscribe === undefined) throw new Error('this test serves no subscriptions');
      return subscribe(inv as Invocation<unknown>, resume) as AsyncIterable<LiveFrame<E>>;
    },
  };
  return { invoker, calls, subscribed };
}

export interface GraphqlRegistered {
  readonly prefix: string;
  readonly handler: HttpHandler;
}

export const graphqlDefaultConfig: GraphqlConfig = {
  cors: [],
  maxBodyBytes: 1_048_576,
  websocket: false,
};

/** What the adapter registered through `host.upgrade`. */
export interface GraphqlUpgraded {
  readonly path: string;
  readonly protocols: readonly string[];
  readonly handler: WebSocketHandler;
}

export interface GraphqlMounted {
  readonly handler: HttpHandler;
  readonly registered: GraphqlRegistered[];
  readonly upgraded: GraphqlUpgraded[];
  readonly calls: Invocation<unknown>[];
  readonly subscribed: Invocation<unknown>[];
  readonly lines: LoggedLine[];
  readonly close: (deadline?: AbortSignal) => Promise<void>;
}

export interface MountOptions {
  readonly config?: Partial<GraphqlConfig>;
  readonly development?: boolean;
  readonly path?: string;
  /** What the invoker's `subscribe` yields; absent, a subscription throws. */
  readonly subscribe?: GraphqlSubscribe;
  /** The surface of each declared API version; absent, `surface` serves every version. */
  readonly surfaces?: VersionProjection<ApiSurface>;
}

/** Mounts the GraphQL adapter on a fake host the way the runtime does and hands back the registered handler. */
export async function mountedGraphql(
  surface: ApiSurface,
  respond: (inv: Invocation<unknown>) => Outcome<unknown> | Promise<Outcome<unknown>>,
  over: MountOptions = {},
): Promise<GraphqlMounted> {
  const registered: GraphqlRegistered[] = [];
  const upgraded: GraphqlUpgraded[] = [];
  const host: TransportHost = {
    route: (spec, handler) => {
      registered.push({ prefix: spec.prefix, handler });
    },
    upgrade: (spec, handler) => {
      upgraded.push({ path: spec.path, protocols: spec.protocols, handler });
    },
    fetch: async () => new Response(null, { status: 404 }),
  };
  const { invoker, calls, subscribed } = graphqlInvoker(respond, over.subscribe);
  const lines: LoggedLine[] = [];
  const log = recordingLogger(lines);
  const context: MountContext<GraphqlConfig> = {
    app: surface.app,
    deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
    surface,
    invoker,
    host,
    config: () => ({ ...graphqlDefaultConfig, ...over.config }),
    telemetry: {} as unknown as Telemetry,
    log,
    ...(over.development === true ? { development: true } : {}),
    ...(over.surfaces === undefined ? {} : { surfaces: over.surfaces }),
  };
  const handle = await createGraphqlAdapter(
    over.path === undefined ? {} : { path: over.path },
  ).mount(context);
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

export interface GraphqlCallOptions {
  readonly headers?: Record<string, string>;
  readonly session?: InvocationSession;
  readonly method?: string;
  readonly rawBody?: string;
  readonly signal?: AbortSignal;
  readonly path?: string;
}

/** One request through the handler, as the host would pass it. */
export async function sendGraphql(
  handler: HttpHandler,
  body: unknown,
  options: GraphqlCallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  const method = options.method ?? 'POST';
  const raw = options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  if (method === 'POST' && raw !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const request = new Request('https://portal.example/graphql', {
    method,
    headers,
    ...(method === 'POST' && raw !== undefined ? { body: raw } : {}),
  });
  const context: HttpContext = {
    session: options.session ?? graphqlSession(),
    carrier: { transport: 'http', host: 'portal.example', path: '/graphql', headers: {} },
    requestId: graphqlRequestId,
    signal: options.signal ?? new AbortController().signal,
    path: options.path ?? '/',
    basePath: '/graphql',
  };
  return await handler(request, context);
}

/** What `JSON.parse` answers: the tests read the parsed answer by path. */
export type Parsed = ReturnType<typeof JSON.parse>;

export interface GraphqlAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Parsed;
}

/** Sends one query and parses the JSON answer. */
export async function ask(
  handler: HttpHandler,
  query: string,
  variables?: Record<string, unknown>,
  options: GraphqlCallOptions = {},
): Promise<GraphqlAnswer> {
  const response = await sendGraphql(
    handler,
    { query, ...(variables === undefined ? {} : { variables }) },
    options,
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? {} : JSON.parse(text),
  };
}

/** The deterministic UUID of the n-th row of a test. */
export function uuidOf(n: number): string {
  return `0198a1e0-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

/** The public id of the n-th row of an entity. */
export function publicId(prefix: string, n: number): string {
  return renderTypeId(prefix, uuidOf(n));
}

/** A handler built straight from the pieces, to run the gate with limits other than the defaults. */
export function handlerWithLimits(
  surface: ApiSurface,
  respond: (inv: Invocation<unknown>) => Outcome<unknown> | Promise<Outcome<unknown>>,
  limits: SelectionLimits,
  subscribe?: GraphqlSubscribe,
): {
  readonly handler: HttpHandler;
  readonly calls: Invocation<unknown>[];
  readonly subscribed: Invocation<unknown>[];
} {
  const { invoker, calls, subscribed } = graphqlInvoker(respond, subscribe);
  const log = recordingLogger();
  const host: TransportHost = {
    route: () => undefined,
    upgrade: () => undefined,
    fetch: async () => new Response(null, { status: 404 }),
  };
  const context: MountContext<GraphqlConfig> = {
    app: surface.app,
    deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
    surface,
    invoker,
    host,
    config: () => graphqlDefaultConfig,
    telemetry: {} as unknown as Telemetry,
    log,
  };
  const handler = createGraphqlHandler({
    versions: graphqlVersionMounts(context, {}, limits),
    invoker,
    config: () => graphqlDefaultConfig,
    limits,
    log,
    development: false,
  });
  return { handler, calls, subscribed };
}

/** The surface with the members of one action replaced (a hint, an input, an output). */
export function surfaceWithAction(
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
export function findAction(surface: ApiSurface, ref: string): ApiSurface['actions'][number] {
  const found = surface.actions.find((candidate) => candidate.ref === ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}
