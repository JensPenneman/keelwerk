import { trace } from '@opentelemetry/api';
import { effectiveRules } from '../authorization/effective-rules.ts';
import type { HookPayloads } from '../dsl/define-hook.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { runCommand } from '../write-path/run-command.ts';
import type { ControlStore } from './control-store.ts';
import { hookActionOf } from './hook-action-of.ts';
import { hookJobKey } from './hook-job-key.ts';
import { hookQueue } from './hook-queue.ts';
import { recordHookEvent } from './record-hook-event.ts';

/** The tenant a hook payload names, for the hooks that run on a tenant. */
function tenantIdOf(
  hook: keyof HookPayloads,
  payload: HookPayloads[keyof HookPayloads],
): string | undefined {
  return hook === 'onBackendCreated' ? undefined : String(payload.id);
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
  /** The process's quota cache: asked once before the hooks run, so what a hook's decision enqueues takes its lane's limits and meets its queue's cap. */
  readonly quotas: QuotaLimits | undefined;
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
  const limits = await input.quotas?.fresh();
  for (const hook of hooks) {
    const principal = moduleServicePrincipal(hook.module, {
      scope: {
        backend: target.scope.level === 'deployment' ? null : target.scope.backendId,
        tenant: target.scope.level === 'tenant' ? target.scope.tenantId : null,
      },
    });
    const action = hookActionOf(hook, input.head);
    // A hook job the creation queued must not run beside the rerun, a running attempt included (the
    // hooks queue cancels it, and its unit rolls back): it is cancelled first.
    if (input.rerun === true && target.scope.level === 'tenant') {
      await target.handle.adapter.unit(target.namespace, target.scope, (unit) =>
        unit.jobs.cancel(hookQueue, hookJobKey(hook.id)),
      );
    }
    const span = trace.getTracer('keelwerk').startSpan(`keelwerk.hook.${hook.id}`);
    try {
      await runCommand({
        registry,
        adapter: target.handle.adapter,
        namespace: target.namespace,
        scope: target.scope,
        action,
        input: input.payload,
        principal,
        request: { transport: 'runtime', requestId: globalThis.crypto.randomUUID() },
        config: input.config,
        clock: store.clock,
        keys: store.keys,
        compute: store.compute,
        log: store.log,
        trace: span,
        rules: effectiveRules(registry),
        apiVersion: input.head,
        build: store.writer.build,
        behaviours: registryBehaviours(registry),
        hybridClock: store.writer.hybridClock,
        concurrentUnits: target.handle.capabilities?.processes !== 'single',
        ...(limits === undefined ? {} : { quotas: limits }),
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
