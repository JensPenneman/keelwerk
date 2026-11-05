import type {
  ApiSurface,
  HttpContext,
  HttpHandler,
  Invocation,
  InvocationSession,
  Invoker,
  Logger,
  MountContext,
  Outcome,
  Telemetry,
  TransportHost,
} from '@keelwerk/core';
import { createRestAdapter } from '../../src/create-rest-adapter.ts';
import type { RestConfig } from '../../src/rest-config.ts';
import type { RestStaticOptions } from '../../src/rest-static-options.ts';

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

export const requestId = '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11';

export function session(over: Partial<InvocationSession> = {}): InvocationSession {
  const value: InvocationSession = {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    app: 'portal',
    principal: {
      kind: 'anonymous',
      scope: { backend: null, tenant: null },
      claims: {},
      roles: [],
      memberships: [],
      via: 'none',
      ref: null,
    },
    apiVersion: '2026-11-01',
    deprecation: null,
    resolvedBy: 'hostname',
    revalidate: async () => ({ ok: true, value: session(over) }),
    ...over,
  };
  return value;
}

export interface FakeInvoker {
  readonly invoker: Invoker;
  readonly calls: Invocation<unknown>[];
}

/** An invoker whose `invoke` is `run`; opening a session and subscribing are not needed by REST. */
export function invokerWith(run: (inv: Invocation<unknown>) => Promise<Outcome<unknown>>): Invoker {
  return {
    open: async () => ({ ok: true, value: session() }),
    invoke: async <I, O>(inv: Invocation<I>) => (await run(inv)) as Outcome<O>,
    subscribe: () => {
      throw new Error('REST mounts no subscriptions in M1');
    },
  };
}

/** An invoker that answers every invocation with `respond` and records it. */
export function fakeInvoker(respond: (inv: Invocation<unknown>) => Outcome<unknown>): FakeInvoker {
  const calls: Invocation<unknown>[] = [];
  const invoker = invokerWith(async (inv) => {
    calls.push(inv);
    return respond(inv);
  });
  return { invoker, calls };
}

export interface Registered {
  readonly prefix: string;
  readonly handler: HttpHandler;
}

export interface FakeHost {
  readonly host: TransportHost;
  readonly registered: Registered[];
}

export function fakeHost(): FakeHost {
  const registered: Registered[] = [];
  const host: TransportHost = {
    route: (spec, handler) => {
      registered.push({ prefix: spec.prefix, handler });
    },
    upgrade: () => undefined,
    fetch: async () => new Response(null, { status: 404 }),
  };
  return { host, registered };
}

export const defaultConfig: RestConfig = { cors: [], docs: false, maxBodyBytes: 1_048_576 };

export interface Mounted {
  readonly registered: Registered[];
  readonly handler: HttpHandler;
  readonly close: (deadline?: AbortSignal) => Promise<void>;
}

/** Mounts the REST adapter on a fake host the way the runtime does and hands back the registered handler. */
export async function mountRest(
  surface: ApiSurface,
  invoker: Invoker,
  options: RestStaticOptions = {},
  config: Partial<RestConfig> = {},
  development = false,
): Promise<Mounted> {
  const { host, registered } = fakeHost();
  const context: MountContext<RestConfig> = {
    app: surface.app,
    deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
    surface,
    invoker,
    host,
    config: () => ({ ...defaultConfig, ...config }),
    telemetry: {} as unknown as Telemetry,
    log,
    ...(development && { development }),
  };
  const handle = await createRestAdapter(options).mount(context);
  const first = registered[0];
  if (first === undefined) {
    throw new Error('the adapter registered no route');
  }
  return {
    registered,
    handler: first.handler,
    close: (deadline = new AbortController().signal) => handle.close(deadline),
  };
}

export interface CallOptions {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly session?: InvocationSession;
  readonly signal?: AbortSignal;
  /** The tenant prefix the host consumed before the transport's base path. */
  readonly tenantPrefix?: string;
  /** The prefix the handler is registered under; default `/api`. */
  readonly mountPrefix?: string;
}

/** One request through the handler, as the host would pass it. */
export async function call(
  handler: HttpHandler,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  const raw =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (raw !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const request = new Request(`https://portal.example${path}`, {
    method,
    headers,
    ...(raw !== undefined && { body: raw }),
  });
  const tenant = options.tenantPrefix ?? '';
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(tenant)) {
    return new Response(null, { status: 404 });
  }
  // What the host does: it strips the tenant prefix and the prefix it routed on.
  const below = pathname.slice(tenant.length) || '/';
  const mount = options.mountPrefix ?? '/api';
  const routed = below === mount || below.startsWith(`${mount}/`) ? mount : below;
  const context: HttpContext = {
    session: options.session ?? session(),
    carrier: { transport: 'http', host: 'portal.example', path, headers: {} },
    requestId,
    signal: options.signal ?? new AbortController().signal,
    path: below.slice(routed.length) || '/',
    basePath: `${tenant}${routed}`,
  };
  return await handler(request, context);
}

export const profileId = 'prof_01h455vb4pex5vsknk084sn02q';
/** What the invoker receives for `profileId`: the host decodes a TypeID into the stored UUID. */
export const profileUuid = '01890a5d-ac96-774b-bcce-b302099a8057';
