import { commandJobRun } from '../effects/command-job-run.ts';
import { durationMs } from '../effects/duration-ms.ts';
import { jobInput } from '../effects/job-input.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { scheduleCommandId } from './schedule-command-id.ts';
import { scheduleGroup } from './schedule-group.ts';
import { scheduleJitter } from './schedule-jitter.ts';
import { scheduleQueue } from './schedule-queue.ts';
import type { ScheduleScope } from './schedule-scope.ts';

/**
 * The job of one tick (final, golden): kind 'action', queue `scheduleQueue`, the target's scope, the
 * service principal of the schedule's module (`moduleServicePrincipal`, through `jobInput`, whose
 * caller is that module), no cause, the build and API version, the command and its sealed input
 * under the tick's command id (which holds the period), `runAt` the tick plus its jitter, the command id as key (`keep`), and
 * for 'each-tenant' the backend's group so one backend's tenants never take every slot.
 */
export function scheduleTickJob(input: {
  readonly entry: ScheduleEntry;
  readonly action: ActionEntry;
  readonly target: ScheduleScope;
  readonly tick: Temporal.Instant;
  readonly sealedInput: unknown;
  readonly build: { readonly id: string; readonly revision: number };
  readonly apiVersion: string;
  readonly now: Temporal.Instant;
}): StoredJobSpec {
  const { entry, action, target, tick } = input;
  const commandId = scheduleCommandId(entry.ref, target.scopeId, durationMs(entry.every), tick);
  const principal = moduleServicePrincipal(entry.module, {
    scope: {
      backend: target.backendId,
      tenant: target.scope.level === 'tenant' ? target.scope.tenantId : null,
    },
  });
  return {
    ...jobInput({
      scope: target.scope,
      principal,
      caller: entry.module,
      action,
      causation: {},
      build: input.build,
      apiVersion: input.apiVersion,
      now: input.now,
    }),
    kind: 'action',
    queue: scheduleQueue,
    run: commandJobRun(action.ref, input.sealedInput, commandId),
    runAt: tick.add({
      milliseconds: scheduleJitter(entry.ref, target.scopeId, tick, entry.jitter),
    }),
    key: { value: commandId, onConflict: 'keep' },
    ...(entry.scope === 'each-tenant' ? { group: scheduleGroup(entry.ref, target.backendId) } : {}),
  };
}
