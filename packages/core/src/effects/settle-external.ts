import { errors } from '../errors/errors.ts';
import { sealedOutputOf } from '../executors/sealed-output-of.ts';
import { settleKeepingContinuation } from '../executors/settle-keeping-continuation.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';
import type { EffectScene } from './effect-scene.ts';
import { settledErrorOf } from './settled-error-of.ts';
import { timerQueue } from './timer-queue.ts';
import { validateEffectInput } from './validate-effect-input.ts';

type Outcome =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: { readonly code: string } };

/** The outcome as an object of the two known forms, or undefined; reads shapes only, never echoes a value. */
function outcomeOf(value: unknown): Outcome | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { ok } = value as { readonly ok?: unknown };
  if (ok === true) {
    const { value: output } = value as { readonly value?: unknown };
    return typeof output === 'object' && output !== null && !Array.isArray(output)
      ? { ok: true, value: output as Readonly<Record<string, unknown>> }
      : undefined;
  }
  if (ok === false) {
    const { error } = value as { readonly error?: unknown };
    if (typeof error !== 'object' || error === null) return undefined;
    const { code } = error as { readonly code?: unknown };
    return typeof code === 'string' ? { ok: false, error: { code } } : undefined;
  }
  return undefined;
}

/**
 * `settle(effect, outcome)` in a decision (7.9.5): the settled record of an own external effect
 * and its continuation, in the decision's unit. The effect must be one of the module whose
 * decision returns the settle: another module's effect, or one outside the unit's scope, answers
 * `not_found`, so an id is never confirmed across modules or tenants. A settled effect answers
 * `conflict`, and so does the loser of a race with another settle or the deadline timer: the
 * winner is decided under the effect row's lock (`settleEffect`, `forUpdate`), which writes only
 * while the status is `requested`. A secret in a settled output keeps a reference only under the
 * effect module's stamp (`sealEffectOutput`); a failure stores its code and kind, never its
 * message (`settledErrorOf`). The effect's deadline timer is cancelled in the same unit.
 */
export async function settleExternal(scene: EffectScene, effect: SettleEffect): Promise<void> {
  const { run, unit } = scene;
  const { registry } = run;
  const asked = effect.effect;
  const notOurs = () =>
    errors.not_found(`The effect ${asked} is not one of module ${scene.module}'s.`);
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
  const row = await unit.rows.findOne(descriptor, {
    where: { op: 'eq', field: 'id', value: asked },
  });
  if (row === undefined) throw notOurs();
  // The id the row has: the store may find a row by another spelling of its id (upper case on PostgreSQL), and the binding of a sealed output and the deadline key use the stored one.
  const id = String(row.id);
  const entry = registry.effects.get(String(row.type));
  if (entry === undefined || entry.module !== scene.module) throw notOurs();
  if (row.performer !== 'external') {
    throw refuseRequest(`settle of effect ${id}`, 'an executor performs this effect');
  }
  if (row.status !== 'requested') throw errors.conflict(`The effect ${id} is already settled.`);
  const outcome = outcomeOf(effect.outcome);
  if (outcome === undefined) {
    throw errors.validation(
      'The outcome of a settle is { ok: true, value } or { ok: false, error: { code } }.',
      {
        issues: [{ path: ['outcome'], message: 'Not an outcome.' }],
      },
    );
  }
  // Checked before the settle, so a refused output is one refusal and never a retried continuation.
  const checked = outcome.ok
    ? {
        ok: true as const,
        output: validateEffectInput(
          entry.output,
          outcome.value,
          `the output of the effect "${entry.ref}"`,
        ) as Readonly<Record<string, unknown>>,
      }
    : outcome;
  const settled = await settleKeepingContinuation(
    unit,
    {
      registry,
      entry,
      row,
      cause: {
        scope: run.scope,
        causation: {
          commandId: scene.commandId,
          actor: scene.causeActor,
          ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
        },
        build: run.build,
      },
      writer: { hybridClock: scene.hybridClock, build: run.build },
      clock: scene.clock,
    },
    async (inner) =>
      checked.ok
        ? { status: 'succeeded', output: await sealedOutputOf(inner, entry, id, checked.output) }
        : { status: 'failed', error: settledErrorOf(registry, entry, checked.error) },
    Number(row.attempts ?? 0),
  );
  if (settled === undefined) throw errors.conflict(`The effect ${id} is already settled.`);
  if (row.deadline !== undefined && row.deadline !== null) {
    await unit.jobs.cancel(timerQueue, `core:deadline:${id}`);
  }
}
