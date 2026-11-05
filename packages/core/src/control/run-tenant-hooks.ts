import { trace } from '@opentelemetry/api';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { DecideContext } from '../contexts/decide-context.ts';
import type { CoreBase } from '../core-module/core-base-type.ts';
import type { HookPayloads } from '../dsl/define-hook.ts';
import { shape } from '../fields/shape.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import { moduleResolver } from '../reactions/module-resolver.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { runCommand } from '../write-path/run-command.ts';
import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/** The tenant a hook payload names, for the hooks that run on a tenant. */
function tenantIdOf(
  hook: keyof HookPayloads,
  payload: HookPayloads[keyof HookPayloads],
): string | undefined {
  return hook === 'onBackendCreated' ? undefined : String(payload.id);
}

/**
 * Appends `core.tenant.hookFailed` or `core.tenant.hookCompleted` (data `{ hook }`) to the tenant's
 * stream in the control store, where `keelwerk doctor` reads them (S-84). A failure to record is
 * logged and never hides the hook's own outcome.
 */
async function recordHookEvent(
  store: ControlStore,
  tenantId: string,
  type: 'hookFailed' | 'hookCompleted',
  hook: string,
): Promise<void> {
  try {
    await runControlCommand(store, `tenant.${type}`, (ctx) => ({
      events: [ctx.write.core.tenant[type](tenantId as never, { hook })],
    }));
  } catch (error) {
    store.log.error(`the outcome of the lifecycle hook ${hook} could not be recorded`, {
      hook,
      cause: error,
    });
  }
}

/** What the hooks of one new tenant or backend need. */
export interface TenantHooksInput {
  readonly store: ControlStore;
  /** The registry of the app the backend runs. */
  readonly registry: Registry;
  readonly hook: keyof HookPayloads;
  readonly payload: HookPayloads[keyof HookPayloads];
  /** The unit the hooks decide in: the tenant's (or, for `onBackendCreated`, the backend's) scope, namespace and placement. */
  readonly target: ScopeTarget;
  readonly head: string;
  /** `ctx.config` of the hooks: the backend's validated configuration over its defaults (3.4). */
  readonly config: (module: string) => unknown;
  /** A rerun of hooks that failed before: a hook that now succeeds is recorded as completed. */
  readonly rerun?: boolean;
  /** Runs only the hooks with these ids. */
  readonly only?: ReadonlySet<string>;
}

/**
 * Runs the lifecycle hooks of a new tenant or backend (S-27): each hook decides in a unit of its
 * own at the level its name says, after the unit that created the row committed, under its module's
 * service principal. A hook that fails is logged and the others still run; the tenant stays created.
 * Returns the ids of the hooks that failed.
 */
export async function runTenantHooks(input: TenantHooksInput): Promise<readonly string[]> {
  const { store, registry, target } = input;
  const failed: string[] = [];
  const hooks = [...registry.hooks.values()]
    .filter((hook) => hook.hook === input.hook && (input.only?.has(hook.id) ?? true))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tenantId = tenantIdOf(input.hook, input.payload);
  for (const hook of hooks) {
    const principal: ServicePrincipal = {
      kind: 'service',
      id: `${hook.module}.system`,
      idAs: () => null,
      scope: {
        backend: target.scope.level === 'deployment' ? null : target.scope.backendId,
        tenant: target.scope.level === 'tenant' ? target.scope.tenantId : null,
      },
      claims: {},
      roles: [],
      memberships: [],
      via: moduleResolver,
      ref: { resolver: moduleResolver, principalId: `${hook.module}.system` },
    };
    const action: ActionEntry = {
      ref: hook.id,
      module: hook.contributedBy ?? hook.module,
      name: hook.id.slice(hook.id.indexOf('.') + 1),
      mount: 'module',
      kind: 'command',
      instance: false,
      input: shape({}),
      output: shape({}),
      errors: [],
      auth: 'policy',
      scope: hook.unit,
      execution: 'sync',
      idempotent: false,
      offline: false,
      resumable: false,
      hints: {},
      since: input.head,
      changedIn: [],
      handler: (_input: unknown, ctx: unknown) =>
        hook.react(input.payload, ctx as DecideContext<CoreBase>),
    };
    const span = trace.getTracer('keelwerk').startSpan(`keelwerk.hook.${hook.id}`);
    try {
      await runCommand({
        registry,
        adapter: target.handle.adapter,
        namespace: target.namespace,
        scope: target.scope,
        action,
        input: {},
        principal,
        request: { transport: 'runtime', requestId: globalThis.crypto.randomUUID() },
        config: input.config,
        clock: store.clock,
        keys: store.keys,
        compute: store.compute,
        log: store.log,
        trace: span,
        rules: [...registry.rules.values()]
          .filter((rule) => rule.disabled !== true)
          .map(normalizeRule),
        apiVersion: input.head,
        build: store.writer.build,
        behaviours: registryBehaviours(registry),
        hybridClock: store.writer.hybridClock,
        concurrentUnits: target.handle.capabilities?.processes !== 'single',
      });
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      failed.push(hook.id);
      store.log.error(`the lifecycle hook ${hook.id} failed`, { hook: hook.id, cause: error });
      if (tenantId !== undefined) await recordHookEvent(store, tenantId, 'hookFailed', hook.id);
      continue;
    } finally {
      span.end();
    }
    if (input.rerun === true && tenantId !== undefined) {
      await recordHookEvent(store, tenantId, 'hookCompleted', hook.id);
    }
  }
  return failed;
}
