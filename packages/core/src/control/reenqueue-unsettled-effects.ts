import { deadlineTimerKey } from '../effects/deadline-timer-key.ts';
import { enqueueDeadlineJob } from '../effects/enqueue-deadline-job.ts';
import { enqueueEffectJob } from '../effects/enqueue-effect-job.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { effectConfigOf } from '../executors/effect-config-of.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Clock } from '../kernel/clock.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Connected } from '../runtime/connected.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import { effectCauseOf } from './effect-cause-of.ts';

const pageSize = 100;

/**
 * After a restore, in the target scope, every `core.effect` row with status `requested` gets what
 * its request enqueued again (14.7.6; key = effect id or `core.deadline:<id>`): the restored rows
 * may be older than their jobs, and a job the restored queue lacks would leave the effect requested
 * for ever. A row whose job is alive in any state, running included (`JobStore.keyed`: a job that
 * was taken when the backup was made is restored as running and returns to the queue when its
 * lease ends), gets no second job. An effect with an executor gets its effect job again, at the
 * `runAt` it was requested for; an effect with an outside performer and a `deadline` gets its
 * deadline timer again; an outside performer's effect without a deadline has no job to restore.
 * The jobs act as the module's service principal and carry the cause of the request: the command,
 * the actor, the cause event and the reaction lineage of its `requested` event (`effectCauseOf`).
 * The jobs take their lane's cap and weight from the limits the process's quota cache gives when asked just before
 * (`quotas`), and carry no queued cap: the framework accepted them already, so they are counted and never refused (9.5.5).
 * An effect type the registry lacks is logged (effect id and type) and skipped; a store or
 * configuration failure rejects, so the restore check fails the start and finds the restore again.
 * Answers the jobs enqueued.
 */
export async function reenqueueUnsettledEffects(input: {
  readonly connected: Connected;
  readonly target: ScopeTarget;
  readonly registry: Registry;
  readonly clock: Clock;
  /** The backend rows and the served apps the effects' configuration is read from. */
  readonly directory: RuntimeServiceContext['directory'];
  readonly apps: RuntimeServiceContext['apps'];
  /** The process's quota cache: asked for fresh limits before each job's unit, so the lane takes the scope's cap and weight. */
  readonly quotas: QuotaLimits | undefined;
}): Promise<number> {
  const { connected, target, registry } = input;
  const { scope } = target;
  const entity = registry.entities.get('core.effect');
  if (entity === undefined || scope.level === 'deployment') return 0;
  const { log } = connected;
  let handled = 0;
  let after: string | undefined;
  for (;;) {
    const page = await target.handle.adapter.unit(
      target.namespace,
      scope,
      (unit) =>
        unit.rows.find(entity.descriptor, {
          where: {
            op: 'and',
            conditions: [{ op: 'eq', field: 'status', value: 'requested' }],
          },
          sort: [{ field: 'id', direction: 'asc' }],
          page: { first: pageSize, ...(after === undefined ? {} : { after }) },
        }),
      { readOnly: true },
    );
    for (const row of page.rows) {
      const effectId = String(row.id);
      const type = String(row.type);
      const effect = registry.effects.get(type);
      const principalOf = (module: string) =>
        moduleServicePrincipal(module, {
          scope: {
            backend: scope.backendId,
            tenant: scope.level === 'tenant' ? scope.tenantId : null,
          },
        });
      const commandId = String(row.commandId);
      const limits = await input.quotas?.fresh();
      if (row.performer === 'external') {
        if (row.deadline === undefined || row.deadline === null) continue;
        if (effect === undefined) {
          log.warn('an effect that a restore left requested is no effect of this build', {
            effect: effectId,
            type,
          });
          continue;
        }
        const enqueued = await target.handle.adapter.unit(target.namespace, scope, async (unit) => {
          if (await unit.jobs.keyed(timerQueue, deadlineTimerKey(effectId))) return false;
          await enqueueDeadlineJob(unit, {
            scope,
            principal: principalOf(effect.module),
            caller: effect.module,
            ...(await effectCauseOf(unit, effectId, commandId)),
            build: connected.build,
            now: input.clock.now(),
            effectId,
            deadline: row.deadline as Temporal.Instant,
            limits,
            exempt: 'accepted',
          });
          return true;
        });
        if (enqueued) handled += 1;
        continue;
      }
      const executor =
        effect?.executor === null || effect === undefined
          ? undefined
          : registry.executors.get(effect.executor);
      if (effect === undefined || executor === undefined) {
        log.warn('an effect that a restore left requested has no executor in this build', {
          effect: effectId,
          type,
        });
        continue;
      }
      const config = await effectConfigOf(input, scope, effect.module);
      const now = input.clock.now();
      const enqueued = await target.handle.adapter.unit(target.namespace, scope, async (unit) => {
        if (await unit.jobs.keyed(executor.queue, effectId)) return false;
        await enqueueEffectJob(unit, {
          scope,
          entry: effect,
          executor,
          effectId,
          input: row.input,
          config: config.value,
          principal: principalOf(effect.module),
          caller: effect.module,
          ...(await effectCauseOf(unit, effectId, commandId)),
          build: connected.build,
          now,
          limits,
          exempt: 'accepted',
          ...(row.runAt === undefined || row.runAt === null
            ? {}
            : { runAt: row.runAt as Temporal.Instant }),
        });
        return true;
      });
      if (enqueued) handled += 1;
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
    after = page.pageInfo.endCursor;
  }
  return handled;
}
