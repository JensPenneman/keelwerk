import { defineApp } from '../../src/dsl/define-app.ts';
import { defineEntity } from '../../src/dsl/define-entity.ts';
import { defineModule } from '../../src/dsl/define-module.ts';
import { defineModuleBase } from '../../src/dsl/define-module-base.ts';
import { defineRule } from '../../src/dsl/define-rule.ts';
import { field } from '../../src/fields/field.ts';
import { createLiveKernel } from '../../src/invoker/create-live-kernel.ts';
import type { InvocationSession } from '../../src/invoker/invocation-session.ts';
import { createInvokerEnv } from '../../src/invoker/invoker-env.ts';
import type { InvokerOptions } from '../../src/invoker/invoker-options.ts';
import type { LiveKernel } from '../../src/live/live-kernel.ts';
import type { Principal } from '../../src/principals/principal.ts';
import type { DataAdapter } from '../../src/storage/data-adapter.ts';
import type { NamespaceRef } from '../../src/storage/namespace-ref.ts';
import type { Scope } from '../../src/storage/scope.ts';
import { accounts } from '../fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../fixtures/modules/auth/src/module.generated.ts';
import { fixedKeys } from './fixed-keys.ts';

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

const app = defineApp({ id: 'portal', modules: [accounts, auth] });
const { registry } = app;

const note = defineEntity({
  prefix: 'note',
  fields: {
    owner: field.string().index(),
    secret: field.string().optional().maskable(),
    taxId: field
      .string()
      .optional()
      .personal({ subject: 'owner', queries: ['eq'] })
      .hidden(),
    email: field
      .string()
      .optional()
      .personal({ subject: 'owner', queries: ['eq'], normalize: 'caseless' }),
    nick: field
      .string()
      .optional()
      .personal({ subject: 'owner', queries: ['prefix'], prefix: { min: 3 } }),
  },
});
const notesBase = defineModuleBase({ id: 'notes', version: '0.1.0', entities: { note } });
const notes = defineModule(notesBase, {
  policies: {
    note: {
      // The owner sees every row, and no maskable field of it: the secret stays masked.
      mine: defineRule(notesBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ owner: ctx.principal.subject }),
        fields: [],
      }),
      // A viewer sees every row, whoever owns it.
      viewers: defineRule(notesBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.roles.includes('viewer') ? {} : false),
        fields: [],
      }),
    },
  },
});
const notesApp = defineApp({ id: 'notes-app', modules: [notes] });
const served = { registry: notesApp.registry, head: '2026-11-04' };
const entity = 'accounts.profile';
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const namespace: NamespaceRef = {
  id: 'ns-1',
  placementId: 'main',
  appId: 'portal',
  tenantId: null,
  root: 'portal',
};

/** An adapter whose unit counts the relation questions it is asked. */
function recordingAdapter() {
  const matching: { readonly ids: readonly string[]; readonly relation: unknown }[] = [];
  const unit = {
    rows: {
      matching: async (_entity: unknown, ids: readonly string[], node: { relation?: string }) => {
        matching.push({ ids, relation: node.relation });
        return new Set(ids.filter((_id, at) => at % 2 === 0));
      },
    },
  };
  const adapter = {
    placementId: 'main',
    unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) => fn(unit),
  } as unknown as DataAdapter;
  return { adapter, matching };
}

function operator(): Principal {
  return {
    kind: 'operator',
    id: 'op1',
    roles: [],
    memberships: [],
    claims: {},
    via: 'test',
    ref: null,
  } as unknown as Principal;
}

function setup(over: Partial<InvokerOptions> = {}) {
  const { adapter, matching } = recordingAdapter();
  const served = { registry, head: '2026-11-04' };
  const env = createInvokerEnv({
    apps: new Map([
      ['portal', served],
      ['core', served],
    ]),
    directory: {} as InvokerOptions['directory'],
    placement: () => ({ adapter }),
    clock: { now: () => Temporal.Instant.from('2026-11-04T00:00:00Z') },
    keys: fixedKeys(),
    compute: {} as InvokerOptions['compute'],
    log: silentLog,
    environment: 'test',
    ...over,
  });
  const target = { scope: tenant, namespace, handle: { adapter } };
  const open = (
    principal: Principal,
    apiVersion = '2026-11-04',
    where: Scope = tenant,
    appId = 'portal',
  ) => {
    const session: InvocationSession = {
      scope: where,
      app: appId,
      principal,
      apiVersion,
      deprecation: null,
      resolvedBy: 'hostname',
      revalidate: () => Promise.reject(new Error('not used')),
    };
    env.sessions.register(session, {
      resolved: {
        scope: where,
        app: appId,
        resolvedBy: 'hostname',
        target: { ...target, scope: where },
        backendTarget: null,
      },
      carrier: { transport: 'test' },
    });
    return session;
  };
  const kernelOf = (session: InvocationSession, name = entity): LiveKernel => {
    const details = env.sessions.detailsOf(session);
    if (details === undefined) throw new Error('the session is registered');
    return createLiveKernel(env, session, details, name);
  };
  return { env, matching, open, kernelOf };
}

export { entity, operator, registry, served, setup, tenant };
