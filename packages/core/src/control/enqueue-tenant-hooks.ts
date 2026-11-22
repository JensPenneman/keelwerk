import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import type { Registry } from '../registry/registry.ts';
import type { ControlStore } from './control-store.ts';
import { recordHookEvent } from './record-hook-event.ts';
import { tenantHookJob } from './tenant-hook-job.ts';

/** What the hooks of one new tenant are enqueued from. */
export interface EnqueueTenantHooksInput {
  readonly store: ControlStore;
  readonly registry: Registry;
  readonly target: ScopeTarget;
  readonly tenant: { readonly id: string; readonly name: string };
  /** The process's quota cache: asked before the unit, so the hooks' lane takes the tenant's cap and weight. */
  readonly quotas: QuotaLimits | undefined;
}

/**
 * Enqueues one `tenantHookJob` per `onTenantCreated` hook (sorted by id) in ONE unit of the tenant's
 * scope, right after the creating unit committed. A failure to enqueue is logged and recorded as
 * `hookFailed` for every hook, so `keelwerk doctor` lists them and `rerunTenantHooks` runs them; it
 * never fails the creation.
 */
export async function enqueueTenantHooks(input: EnqueueTenantHooksInput): Promise<void> {
  const { store, registry, target, tenant } = input;
  const hooks = [...registry.hooks.values()]
    .filter((hook) => hook.hook === 'onTenantCreated')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (hooks.length === 0) return;
  try {
    const limits = await input.quotas?.fresh();
    const now = store.clock.now();
    await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
      for (const hook of hooks) {
        await unit.jobs.enqueue(
          tenantHookJob({
            hook,
            tenant,
            scope: target.scope,
            build: store.writer.build,
            now,
            limits,
          }),
        );
      }
    });
  } catch (error) {
    for (const hook of hooks) {
      store.log.error(`the lifecycle hook ${hook.id} could not be enqueued`, {
        hook: hook.id,
        cause: error,
      });
      await recordHookEvent(store, tenant.id, 'hookFailed', hook.id);
    }
  }
}
