import { type HybridClock, hybridClock } from '../clock/hybrid-clock.ts';
import { enqueueEffectJob } from '../effects/enqueue-effect-job.ts';
import { openEffectInput } from '../effects/open-effect-input.ts';
import { requestedEffectDraft } from '../effects/requested-effect-draft.ts';
import { sealEffectInput } from '../effects/seal-effect-input.ts';
import { validateEffectInput } from '../effects/validate-effect-input.ts';
import { writeEffectRecord } from '../effects/write-effect-record.ts';
import { errors } from '../errors/errors.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { inlineTimeoutMs } from '../executors/inline-timeout-ms.ts';
import { recordAttempt } from '../executors/record-attempt.ts';
import { coreError } from '../http/core-error.ts';
import { serviceModuleOf } from '../principals/service-module-of.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import { answerInlineRow } from './answer-inline-row.ts';
import { decodeShapeValue } from './decode-shape-value.ts';
import { defaultNodeId } from './default-node-id.ts';
import type { InlineAnswer } from './inline-answer.ts';
import { inlineGuardGraceMs } from './inline-guard-grace-ms.ts';
import { isFinishedReceipt } from './is-finished-receipt.ts';
import type { PerformInlineInput } from './perform-inline.ts';
import { readInlineReceipt } from './read-inline-receipt.ts';

/** What the begin unit of an inline effect answers. */
export type InlineBegun =
  | { readonly kind: 'answered'; readonly answer: InlineAnswer }
  | {
      readonly kind: 'run';
      readonly input: Readonly<Record<string, unknown>>;
      readonly startedAt: string;
    };

/**
 * The first unit of an inline effect (D3, D4): in one read-write unit of the scope, an existing row
 * answers only the run that asks for the same thing (`answerInlineRow`, whose numbered list gives
 * the checks and their order; a settled effect answers its outcome, a requested one is
 * `core.command_in_progress`). With no row, an unexpired `completed` or `failed` receipt of the
 * command id refuses the new effect (`core.idempotency_mismatch`: phase 3 would replay the recorded
 * outcome) before anything is sealed; otherwise the `requested` record, the start record of attempt
 * 1 and the guard job that settles a run that was cut are written, and the input is opened for the
 * executor. The run's signal is checked last: an abort during the unit rolls all of it back and
 * rejects with the reason, so nothing is stored. A `conflict` of the unit is a second run of the
 * same effect and answers `core.command_in_progress` too.
 */
export async function beginInlineEffect(
  input: PerformInlineInput,
  entry: EffectEntry,
  executor: ExecutorEntry,
): Promise<InlineBegun> {
  const { run, effectId, commandId, effect } = input;
  const { registry } = run;
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
  const validated = validateEffectInput(entry.input, effect.input, `the effect "${entry.ref}"`);
  const processClock: HybridClock = run.hybridClock ?? hybridClock(run.nodeId ?? defaultNodeId);
  const submitter =
    serviceModuleOf(run.principal) === undefined && run.principal.ref != null
      ? run.principal.ref
      : undefined;
  try {
    return await run.adapter.unit(run.namespace, run.scope, async (unit): Promise<InlineBegun> => {
      const now = input.clock.now();
      const meta = buildEventMeta({
        principal: run.principal,
        commandId,
        action: run.action.ref,
        correlationId: run.correlationId ?? run.request.requestId,
        ...(run.job?.causationId === undefined && run.causationId === undefined
          ? {}
          : { causationId: run.job?.causationId ?? run.causationId }),
        build: run.build,
        flags: [],
        decision: null,
        lineage: run.job?.lineage,
      });
      const existing = await unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: effectId },
      });
      if (existing !== undefined) {
        return {
          kind: 'answered',
          answer: await answerInlineRow({
            unit,
            perform: input,
            entry,
            row: existing,
            validated,
            submitter,
            actor: meta.actor,
            now,
          }),
        };
      }
      const receipt = await readInlineReceipt(unit, input, now);
      if (receipt !== undefined && isFinishedReceipt(receipt)) {
        throw coreError('core.idempotency_mismatch', {
          message: 'The command id was used with a different request.',
        });
      }
      const sealed = await sealEffectInput({
        unit,
        registry,
        entry,
        effectId,
        input: validated,
      });
      await writeEffectRecord(
        { unit, run, clock: input.clock, meta, hybridClock: processClock },
        requestedEffectDraft(
          { commandId, eventIds: [], ...(submitter === undefined ? {} : { submitter }) },
          effect,
          entry,
          effectId,
          sealed,
        ),
      );
      const startedAt = now.toString();
      await recordAttempt(unit, registry, effectId, {
        process: run.nodeId ?? defaultNodeId,
        build: run.build.id,
        attempt: 1,
        startedAt,
      });
      await enqueueEffectJob(unit, {
        scope: run.scope,
        entry,
        executor,
        effectId,
        input: sealed,
        config: run.config?.(entry.module),
        principal: moduleServicePrincipal(entry.module, run.principal),
        actor: meta.actor,
        caller: run.action.contributedBy ?? run.action.module,
        causation: {
          commandId,
          ...(meta.lineage === undefined ? {} : { lineage: meta.lineage }),
        },
        build: run.build,
        now,
        runAt: now.add({ milliseconds: inlineTimeoutMs(executor) + inlineGuardGraceMs }),
      });
      const opened = await openEffectInput(
        unit,
        entry,
        effectId,
        typeof sealed === 'object' && sealed !== null
          ? (sealed as Readonly<Record<string, unknown>>)
          : {},
      );
      if (opened.mismatched.length > 0 || opened.erased.length > 0) {
        throw errors.internal('A personal member of the inline effect cannot be opened.');
      }
      const decoded = decodeShapeValue(entry.input, entry.module, opened.input) as Readonly<
        Record<string, unknown>
      >;
      // Last: an abort during the unit rolls back the record, the attempt, the guard job and the seal.
      run.signal?.throwIfAborted();
      return { kind: 'run', input: decoded, startedAt };
    });
  } catch (error) {
    if (
      isKeelwerkError(error) &&
      error.kind === 'conflict' &&
      error.code !== 'core.idempotency_mismatch'
    ) {
      throw coreError('core.command_in_progress');
    }
    throw error;
  }
}
