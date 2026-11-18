import { jobInput } from '../effects/job-input.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { HookEntry } from '../registry/hook-entry.ts';
import type { Scope } from '../storage/scope.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { hookJobKey } from './hook-job-key.ts';
import { hookQueue } from './hook-queue.ts';

/** What the job of one `onTenantCreated` hook is built from. */
export interface TenantHookJobOptions {
  readonly hook: HookEntry;
  readonly tenant: { readonly id: string; readonly name: string };
  /** The tenant's scope. */
  readonly scope: Scope;
  /** The enqueuer's build (section 19.2). */
  readonly build: { readonly id: string; readonly revision: number };
  readonly now: Temporal.Instant;
}

/**
 * The keyed job of one `onTenantCreated` hook (decision 147, S-158; the stored form is final): an
 * action job on the queue `hooks`, run under the service principal of the hook's module in the
 * tenant's scope. The run is the hook's id with the payload `{ id, name }` and
 * `kernel:hook:<hook id>:<tenant id>` as command id, the idempotency key of (hook, tenant); the key
 * is `hookJobKey(hook id)` and the dead letter names the hook's id. The job names no API version and no retry policy,
 * so the default applies.
 */
export function tenantHookJob(options: TenantHookJobOptions): StoredJobSpec {
  const { hook, tenant, scope } = options;
  const principal = moduleServicePrincipal(hook.module, {
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
  });
  return {
    ...jobInput({
      scope,
      principal,
      caller: hook.module,
      causation: {},
      build: options.build,
      now: options.now,
    }),
    kind: 'action',
    queue: hookQueue,
    run: {
      action: hook.id,
      input: { id: tenant.id, name: tenant.name },
      commandId: kernelCommandId('hook', hook.id, tenant.id),
    },
    key: { value: hookJobKey(hook.id), onConflict: 'keep' },
    deadLetter: hook.id,
  };
}
