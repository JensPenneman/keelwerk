import { checkEffectScope } from '../../effects/check-effect-scope.ts';
import { checkTimerKey } from '../../effects/check-timer-key.ts';
import { checkTimerScope } from '../../effects/check-timer-scope.ts';
import { commandActionOf } from '../../effects/command-action-of.ts';
import { commandJobRun } from '../../effects/command-job-run.ts';
import { commandQueue } from '../../effects/command-queue.ts';
import { crossScopeGroup } from '../../effects/cross-scope-group.ts';
import { principalRefOf } from '../../effects/principal-ref-of.ts';
import { sealJobInput } from '../../effects/seal-job-input.ts';
import { timerQueue } from '../../effects/timer-queue.ts';
import { kernelCommandId } from '../../ids/kernel-command-id.ts';
import { newUuidV7 } from '../../ids/new-uuid-v7.ts';
import { refuseRequest } from '../../interpreter/refuse-request.ts';
import type { JobGroup } from '../../jobs/job-group.ts';
import type { Principal } from '../../principals/principal.ts';
import type { PrincipalRef } from '../../principals/principal-ref.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
import { moduleServicePrincipal } from '../../reactions/module-service-principal.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { StoredJobSpec } from '../../storage/stored-job-spec.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';

/** The lane cap of a queue the invoker upserts; the runtime's queue limits replace it (WP-36). */
const laneCap = 4;

function idOf(principal: Principal): string {
  if (principal.kind === 'user') return String(principal.subject);
  return 'id' in principal ? principal.id : principal.kind;
}

const unitMs = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

/** '45s', '2m', '500ms' or '1h' after the clock's now. */
function afterNow(env: InvokerEnv, after: string): Temporal.Instant {
  const parts = /^(\d+)(ms|s|m|h)$/.exec(after);
  const unit = parts?.[2] as keyof typeof unitMs | undefined;
  if (parts === null || unit === undefined) {
    throw refuseRequest(
      `the timer delay "${after}"`,
      "a principal resolver's timer delay is a whole number of ms, s, m or h",
    );
  }
  return env.options.clock.now().add({ milliseconds: Number(parts[1]) * unitMs[unit] });
}

function jobOf(
  env: InvokerEnv,
  target: ScopeTarget,
  principal: Principal,
  effect: AnyEffect,
  module: string | undefined,
): StoredJobSpec {
  const principalRef: PrincipalRef = principal.ref ?? {
    resolver: principal.via,
    principalId: idOf(principal),
  };
  const common = {
    kind: 'action',
    laneCap,
    createdAt: env.options.clock.now(),
    scope: target.scope,
    principal: principalRef,
    causation: { actor: { kind: principal.kind, id: idOf(principal), via: principal.via } },
    build: env.options.build ?? { id: 'development', revision: 1 },
  } as const;
  if (effect.kind === 'enqueue') {
    return {
      ...common,
      queue: commandQueue,
      run: commandJobRun(effect.action, effect.input, kernelCommandId('effect', newUuidV7())),
      ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
      ...(effect.key === undefined ? {} : { key: { value: effect.key, onConflict: 'keep' } }),
    };
  }
  const runAt =
    effect.kind === 'setTimer'
      ? (effect.at ?? (effect.after === undefined ? undefined : afterNow(env, effect.after)))
      : undefined;
  if (effect.kind === 'setTimer' && runAt !== undefined) {
    checkTimerKey(effect.key);
    if (module === undefined) {
      throw refuseRequest(
        `the timer "${effect.key}"`,
        'a timer needs the module whose resolver set it',
      );
    }
    return {
      ...common,
      principal: principalRefOf(moduleServicePrincipal(module, principal)),
      queue: timerQueue,
      run: commandJobRun(effect.action, effect.input, kernelCommandId('timer', newUuidV7())),
      runAt,
      key: { value: effect.key, onConflict: 'replace' },
    };
  }
  throw refuseRequest(
    `the effect "${effect.kind}"`,
    'a principal resolver may return enqueue effects and timers only',
  );
}

/**
 * The command a resolver's job names, found in the registry of the app the session belongs to: an
 * effect names a command of that app or nothing. An enqueue is checked as the resolver's principal
 * would be for its own `enqueue`; a timer stays in the session's scope (`checkTimerScope`).
 */
function commandOf(
  env: InvokerEnv,
  target: ScopeTarget,
  principal: Principal,
  job: StoredJobSpec,
): { readonly action: ActionEntry; readonly group?: JobGroup } | undefined {
  if (!('action' in job.run)) return undefined;
  const { registry } = env.appOf(target.namespace.appId);
  if (job.queue === timerQueue) {
    const action = commandActionOf(registry, job.run.action, 'setTimer');
    checkTimerScope(job.scope, action, principal);
    return { action };
  }
  const action = commandActionOf(registry, job.run.action, 'enqueue');
  const placement = checkEffectScope(job.scope, action, 'enqueue', principal);
  return placement === 'backend' && job.scope.level === 'tenant'
    ? { action, group: crossScopeGroup(job.scope.backendId) }
    : { action };
}

/**
 * Performs the effects a principal resolver returned (auth's idle extension) in a short
 * read-write unit of the session's scope, right after `open` (S-24). They become keyed job rows; a timer runs
 * under the service principal `core.module` mints for the module whose resolver returned it
 * (section 9.5, decision 335), and an enqueue under the session's principal; each under a kernel
 * command id of its own, with the secret members of its input sealed in the unit, so a job that
 * crosses scopes has the receipt that holds it once. A timer without a module, or naming no command
 * of the app, is refused, and so is a timer or an enqueue naming a command its scope may not reach;
 * a timer never crosses scopes. Every effect is checked before the unit opens, so a refused one
 * writes nothing.
 */
export async function performResolverEffects(
  env: InvokerEnv,
  target: ScopeTarget,
  principal: Principal,
  effects: readonly AnyEffect[],
  module?: string,
): Promise<void> {
  if (effects.length === 0) return;
  const jobs = effects.map((effect) => {
    const job = jobOf(env, target, principal, effect, module);
    return { job, command: commandOf(env, target, principal, job) };
  });
  await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
    for (const { job, command } of jobs) {
      if (command === undefined || !('action' in job.run) || job.run.commandId === undefined) {
        await unit.jobs.enqueue(job);
        continue;
      }
      const sealed = await sealJobInput(unit, job.run.commandId, command.action, job.run.input);
      await unit.jobs.enqueue({
        ...job,
        run: commandJobRun(job.run.action, sealed, job.run.commandId),
        ...(command.group === undefined ? {} : { group: command.group }),
      });
    }
  });
}
