import { trace } from '@opentelemetry/api';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { errors } from '../errors/errors.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { isRecordedFailure } from '../write-path/is-recorded-failure.ts';
import { recordFailedReceipt } from '../write-path/record-failed-receipt.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { runCommand } from '../write-path/run-command.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { ControlRun } from './control-run.ts';
import type { ControlStore } from './control-store.ts';

/** An id answerer that hands out the pinned id, which the row about to be created already carries in sealed values. */
function pinnedId(id: string): RequestAnswerer['id'] {
  return async () => id;
}

/** What a control create is decided with besides who asks. */
export interface ControlCreate {
  /** The values the command decides with (secrets already sealed). */
  readonly values: Readonly<Record<string, unknown>>;
  /** The client's own input, which the receipt's fingerprint covers; sealed values never reach it. */
  readonly fingerprintInput: unknown;
  /** Pins the id of the new row (the runtime's own seam, never a client's input). */
  readonly id?: string;
  /** The checks were skipped because a live receipt exists: the command may only replay (S-111). */
  readonly replayOnly?: boolean;
}

/**
 * Runs the explicit `core.backend.create` or `core.tenant.create` in the control store as the
 * given principal (S-109): the write path a request takes, below the pipeline, marked as the
 * control path so `refuseGeneratedWrite` lets it through. With a command id the receipt makes a
 * retry answer the same id (`replayed`), and a deterministic refusal is pinned to the id.
 */
export async function runControlCreate(
  store: ControlStore,
  entity: 'backend' | 'tenant',
  create: ControlCreate,
  who: ControlRun,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  const { registry } = store;
  const action = registry.actions.get(`core.${entity}.create`);
  if (action === undefined) {
    throw errors.internal(`the control store has no core.${entity}.create`);
  }
  const span = trace.getTracer('keelwerk').startSpan(`keelwerk.control.${entity}.create`);
  const input: RunCommandInput = {
    registry,
    adapter: store.adapter,
    namespace: store.namespace,
    scope: { level: 'deployment' },
    action,
    input: create.values,
    fingerprintInput: create.fingerprintInput,
    controlPath: true,
    ...(create.replayOnly === true ? { replayOnly: true } : {}),
    ...(create.id === undefined ? {} : { replace: { id: pinnedId(create.id) } }),
    principal: who.principal,
    request: who.request ?? { transport: 'runtime', requestId: globalThis.crypto.randomUUID() },
    clock: store.clock,
    keys: store.keys,
    compute: store.compute,
    log: store.log,
    trace: span,
    rules: [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    apiVersion: who.apiVersion ?? coreApiVersions.dates[0] ?? '',
    build: store.writer.build,
    behaviours: registryBehaviours(registry),
    hybridClock: store.writer.hybridClock,
    concurrentUnits: store.capabilities.processes !== 'single',
    ...(who.commandId === undefined ? {} : { commandId: who.commandId }),
    ...(who.signal === undefined ? {} : { signal: who.signal }),
  };
  try {
    const result = await runCommand(input);
    return {
      id: String((result.output as { id: unknown }).id),
      replayed: result.replayed === true,
    };
  } catch (error) {
    if (who.commandId !== undefined && isRecordedFailure(error)) {
      await recordFailedReceipt(input, who.commandId, error).catch(() => undefined);
    }
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}
