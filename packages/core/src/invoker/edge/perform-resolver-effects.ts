import { refuseRequest } from '../../interpreter/refuse-request.ts';
import type { Principal } from '../../principals/principal.ts';
import type { PrincipalRef } from '../../principals/principal-ref.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
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
      queue: 'commands',
      run: { action: effect.action, input: effect.input },
      ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
      ...(effect.key === undefined ? {} : { key: { value: effect.key, onConflict: 'keep' } }),
    };
  }
  const runAt =
    effect.kind === 'setTimer'
      ? (effect.at ?? (effect.after === undefined ? undefined : afterNow(env, effect.after)))
      : undefined;
  if (effect.kind === 'setTimer' && runAt !== undefined) {
    return {
      ...common,
      principal:
        module === undefined
          ? common.principal
          : { resolver: 'core.invoker', principalId: `${module}.system` },
      queue: 'timers',
      run: { action: effect.action, input: effect.input },
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
 * Performs the effects a principal resolver returned (auth's idle extension) in a short
 * read-write unit of the session's scope, right after `open` (S-24). They become keyed job rows, a timer under the service principal of the module whose resolver returned it (section 9.5);
 * M1 runs no worker, so a session does not slide until M2. Every effect is checked before the
 * unit opens, so a refused one writes nothing.
 */
export async function performResolverEffects(
  env: InvokerEnv,
  target: ScopeTarget,
  principal: Principal,
  effects: readonly AnyEffect[],
  module?: string,
): Promise<void> {
  if (effects.length === 0) return;
  const jobs = effects.map((effect) => jobOf(env, target, principal, effect, module));
  await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
    for (const job of jobs) await unit.jobs.enqueue(job);
  });
}
