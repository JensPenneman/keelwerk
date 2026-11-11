import type { Tracer } from '@opentelemetry/api';
import type { PrincipalResolver } from '../../src/edge/principal-resolver.ts';
import { errors } from '../../src/errors/errors.ts';
import type { KeelwerkError } from '../../src/errors/keelwerk-error.ts';
import { field } from '../../src/fields/field.ts';
import { shape } from '../../src/fields/shape.ts';
import { createInvoker } from '../../src/invoker/create-invoker.ts';
import type { Invocation } from '../../src/invoker/invocation.ts';
import type { InvocationSession } from '../../src/invoker/invocation-session.ts';
import type { Invoker } from '../../src/invoker/invoker.ts';
import type { InvokerOptions } from '../../src/invoker/invoker-options.ts';
import type { Outcome } from '../../src/invoker/outcome.ts';
import type { Principal } from '../../src/principals/principal.ts';
import type { ActionEntry } from '../../src/registry/action-entry.ts';
import type { EntityEntry } from '../../src/registry/entity-entry.ts';
import type { ExtensionFillEntry } from '../../src/registry/extension-fill-entry.ts';
import type { Registry } from '../../src/registry/registry.ts';
import type { DataAdapter } from '../../src/storage/data-adapter.ts';
import type { NamespaceRef } from '../../src/storage/namespace-ref.ts';
import { post } from '../authorization/post-fixture.ts';
import { staticScopeDirectory } from './static-scope-directory.ts';

const namespace: NamespaceRef = {
  id: 'ns-1',
  placementId: 'main',
  appId: 'doc',
  tenantId: null,
  root: 'doc',
};
const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};
const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;

const anonymous = {
  kind: 'anonymous',
  scope: { backend: 'b1', tenant: 't1' },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test',
  ref: null,
} as unknown as Principal;

function user(subject: string): Principal {
  return {
    kind: 'user',
    subject,
    subjectRef: null,
    subjectAs: () => null,
    scope: { backend: 'b1', tenant: 't1' },
    claims: {},
    roles: [],
    memberships: [],
    via: 'test',
    ref: null,
  } as unknown as Principal;
}

function actionOf(ref: string, over: Partial<ActionEntry> = {}): ActionEntry {
  const [module = 'doc', name = ref] = ref.split('.');
  return {
    ref,
    module,
    name,
    mount: 'module',
    kind: 'query',
    instance: false,
    input: shape({ n: field.integer() }),
    output: shape({}),
    errors: [],
    auth: 'policy',
    scope: 'tenant',
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-01',
    changedIn: [],
    handler: () => ({}),
    ...over,
  } as ActionEntry;
}

/** A registry of the actions given, over the `doc.post` entity, with no modules beyond `doc`. */
function registryOf(actions: readonly ActionEntry[], extra: Partial<Registry> = {}): Registry {
  const entity = { ref: 'doc.post', module: 'doc', name: 'post', descriptor: post } as EntityEntry;
  return {
    app: 'doc',
    modules: [
      { id: 'doc', contextName: 'doc', requires: [], optional: [], flags: {}, extensionPoints: [] },
    ],
    entities: new Map([['doc.post', entity]]),
    actions: new Map(actions.map((action) => [action.ref, action])),
    rules: new Map(),
    fills: new Map(),
    extensionPoints: new Map(),
    versionChanges: new Map(),
    ...extra,
  } as unknown as Registry;
}

const directory = staticScopeDirectory({
  backends: [{ id: 'b1', app: 'doc', placementId: 'main', namespace, status: 'active' }],
  tenants: [
    { id: 't1', backendId: 'b1', placementId: 'main', namespace, status: 'active' },
    { id: 't-off', backendId: 'b1', placementId: 'main', namespace, status: 'suspended' },
  ],
  domains: [{ hostname: 'doc.example', backendId: 'b1', tenantId: 't1' }],
});

/** An adapter whose units run `fn` on an empty unit: a stage that touches the unit fails with a TypeError. */
function adapterOf(): DataAdapter {
  return {
    placementId: 'main',
    unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) => fn({}),
  } as unknown as DataAdapter;
}

function fill(point: string, value: unknown): ExtensionFillEntry {
  return { point, module: 'doc', bound: false, fill: value };
}

/** A principal resolver of the tests: `tok-<subject>` signs in, `bad` throws, a stale cookie is anonymous. */
const resolver: PrincipalResolver = {
  id: 'test.token',
  describe: () => ({ scheme: 'bearer' }),
  // biome-ignore lint/correctness/useYield: the test resolver loads nothing
  *resolve(carrier) {
    if (carrier.headers?.cookie === 'sid=stale') {
      return { principal: anonymous, clearCookies: ['sid'] };
    }
    const header = carrier.headers?.authorization ?? '';
    const token = header.slice('Bearer '.length);
    if (token === 'bad') throw errors.unauthenticated('The token is invalid.');
    if (token === 'boom') throw new Error('resolver exploded');
    return token.startsWith('tok-') ? { principal: user(token.slice(4)) } : null;
  },
};

const withResolver = (registry: Registry): Registry => ({
  ...registry,
  fills: new Map([
    ...registry.fills,
    ['core.principalResolvers', [fill('core.principalResolvers', resolver)]],
  ]),
});

function invokerOf(registry: Registry, over: Partial<InvokerOptions> = {}): Invoker {
  return createInvoker({
    apps: new Map([
      ['doc', { registry: withResolver(registry), head: '2026-11-01' }],
      ['core', { registry: withResolver(registry), head: '2026-11-01' }],
    ]),
    directory,
    placement: () => ({ adapter: adapterOf() }),
    tenantResolution: [{ kind: 'header', header: 'x-tenant' }, { kind: 'hostname' }],
    clock: { now: () => Temporal.Instant.from('2026-11-04T00:00:00Z') },
    keys: {} as InvokerOptions['keys'],
    compute: {} as InvokerOptions['compute'],
    log: silentLog,
    environment: 'test',
    ...over,
  });
}

const carrier = { transport: 'test', headers: { 'x-tenant': 't1' } } as const;
const signedIn = {
  transport: 'test',
  headers: { 'x-tenant': 't1', authorization: 'Bearer tok-ada' },
} as const;

function callOf(
  action: string,
  input: unknown,
  over: Partial<Invocation<unknown>> & Pick<Invocation<unknown>, 'carrier'>,
): Invocation<unknown> {
  return { action, input, requestId: 'r1', signal: new AbortController().signal, ...over };
}

function failureOf<T>(outcome: Outcome<T>): KeelwerkError {
  if (outcome.ok) throw new Error('expected a failure');
  return outcome.error;
}

function sessionOf(outcome: Outcome<InvocationSession>): InvocationSession {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** A tracer that counts the spans it started and ended. */
function countingTracer(): {
  readonly tracer: Tracer;
  readonly started: () => number;
  readonly ended: () => number;
} {
  let started = 0;
  let ended = 0;
  const span = {
    setStatus: () => span,
    setAttribute: () => span,
    end: () => {
      ended += 1;
    },
  };
  const tracer = {
    startSpan: () => {
      started += 1;
      return span;
    },
  } as unknown as Tracer;
  return { tracer, started: () => started, ended: () => ended };
}

export {
  actionOf,
  adapterOf,
  callOf,
  carrier,
  countingTracer,
  failureOf,
  fill,
  invokerOf,
  namespace,
  registryOf,
  scope,
  sessionOf,
  signedIn,
  user,
  withResolver,
};
