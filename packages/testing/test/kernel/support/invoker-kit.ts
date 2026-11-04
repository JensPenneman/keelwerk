import type {
  ActionEntry,
  DataAdapter,
  ExtensionFillEntry,
  Invocation,
  Invoker,
  InvokerOptions,
  KeyService,
  Outcome,
  Principal,
  PrincipalResolver,
  Registry,
  Scope,
} from '@keelwerk/core';
import {
  createInvoker,
  errors,
  type KeelwerkError,
  shape,
  staticScopeDirectory,
} from '@keelwerk/core';
import type { ProbeContext } from './run-read-kit.ts';
import {
  anonymous,
  clock,
  namespace,
  open,
  registry,
  silent,
  tenant,
  userOf,
  withQuery,
} from './run-read-kit.ts';

const backendId = tenant.level === 'tenant' ? tenant.backendId : '';
const tenantId = tenant.level === 'tenant' ? tenant.tenantId : '';
const otherTenantId = 'tnt-other';
const otherTenant: Scope = { level: 'tenant', backendId, tenantId: otherTenantId };
const head = '2026-11-01';

const directory = staticScopeDirectory({
  backends: [{ id: backendId, app: 'library', placementId: 'main', namespace, status: 'active' }],
  tenants: [
    { id: tenantId, backendId, placementId: 'main', namespace, status: 'active' },
    { id: otherTenantId, backendId, placementId: 'main', namespace, status: 'active' },
    {
      id: 'tnt-suspended',
      backendId,
      placementId: 'main',
      namespace,
      status: 'suspended',
    },
  ],
  domains: [{ hostname: 'lib.example', backendId, tenantId }],
});

const byHeaderCarrier = {
  transport: 'test',
  headers: { 'x-tenant': tenantId },
} as const;

/** A principal resolver of the tests: `tok-<subject>` signs in, `bad` is an invalid bearer token, a stale cookie is anonymous. */
function testResolver(own: ProbeContext): PrincipalResolver {
  return {
    id: 'test.token',
    describe: () => ({ scheme: 'bearer' }),
    *resolve(carrier) {
      if (carrier.headers?.cookie?.includes('sid=stale') === true) {
        return { principal: anonymous, clearCookies: ['sid'] };
      }
      const header = carrier.headers?.authorization;
      if (header === undefined) return null;
      const token = header.slice('Bearer '.length);
      if (token === 'bad') throw errors.unauthenticated('The token is invalid.');
      if (!token.startsWith('tok-')) return null;
      const known = yield* own.load.library.book.count();
      const principal = userOf(token.slice(4));
      return {
        principal: { ...principal, claims: { books: known } },
        ...(token === 'tok-slide'
          ? {
              effects: [
                {
                  kind: 'enqueue',
                  type: 'enqueue',
                  action: 'library.addBook',
                  input: {},
                  key: 'slide',
                } as const,
              ],
            }
          : {}),
      };
    },
  };
}

function withFills(base: Registry, fills: Readonly<Record<string, readonly ExtensionFillEntry[]>>) {
  return { ...base, fills: new Map([...base.fills, ...Object.entries(fills)]) };
}

const resolverFill: ExtensionFillEntry = {
  point: 'core.principalResolvers',
  module: 'library',
  bound: true,
  fill: (own: unknown) => testResolver(own as ProbeContext),
};

const enricherFill: ExtensionFillEntry = {
  point: 'core.principalEnrichers',
  module: 'library',
  bound: false,
  fill: {
    id: 'test.roles',
    // biome-ignore lint/correctness/useYield: an enricher with nothing to load
    *enrich(principal: Principal) {
      return { roles: principal.kind === 'user' ? ['reader'] : [] };
    },
  },
};

const base = withFills(registry, {
  'core.principalResolvers': [resolverFill],
  'core.principalEnrichers': [enricherFill],
});

/** A copy of the fixture's query that anyone may call, with `over` applied. */
function publicQuery(
  name: string,
  handler: ActionEntry['handler'],
  over: Partial<ActionEntry> = {},
  from: Registry = base,
) {
  const added = withQuery(name, handler, from);
  const action = added.registry.actions.get(added.ref);
  if (action === undefined) throw new Error('missing probe');
  const { principal: _principal, ...rest } = action;
  const probe: ActionEntry = {
    ...rest,
    auth: 'public',
    input: shape({}),
    output: shape({}),
    ...over,
  };
  return {
    ref: added.ref,
    registry: {
      ...added.registry,
      actions: new Map([...added.registry.actions, [added.ref, probe]]),
    },
  };
}

interface Kit {
  readonly adapter: DataAdapter;
  readonly invoker: Invoker;
}

function kit(
  over: Partial<InvokerOptions> & {
    readonly registry?: Registry;
    readonly adapter?: DataAdapter;
  } = {},
): Kit {
  const adapter = over.adapter ?? open();
  const { registry: served, adapter: _adapter, ...options } = over;
  const invoker = createInvoker({
    apps: new Map([
      ['library', { registry: served ?? base, head }],
      ['core', { registry: served ?? base, head }],
    ]),
    directory,
    placement: () => ({ adapter }),
    tenantResolution: [{ kind: 'header', header: 'x-tenant' }, { kind: 'hostname' }],
    clock,
    keys: {} as KeyService,
    compute: {
      argon2idHash: async () => '',
      argon2idVerify: async () => true,
      close: async () => {},
    },
    log: silent,
    environment: 'test',
    ...options,
  });
  return { adapter, invoker };
}

function call(
  action: string,
  input: unknown,
  over: Partial<Invocation<unknown>> & Pick<Invocation<unknown>, 'carrier'>,
): Invocation<unknown> {
  return { action, input, requestId: 'req-1', signal: new AbortController().signal, ...over };
}

const ada = {
  ...byHeaderCarrier,
  headers: { ...byHeaderCarrier.headers, authorization: 'Bearer tok-ada' },
};

async function session(invoker: Invoker, carrier: Parameters<Invoker['open']>[0]) {
  const opened = await invoker.open(carrier);
  if (!opened.ok) throw opened.error;
  return opened.value;
}

function failure<T>(outcome: Outcome<T>): KeelwerkError {
  if (outcome.ok) throw new Error('expected a failure');
  return outcome.error;
}

export {
  ada,
  backendId,
  base,
  byHeaderCarrier,
  call,
  directory,
  failure,
  head,
  kit,
  otherTenant,
  otherTenantId,
  publicQuery,
  session,
  tenantId,
};
