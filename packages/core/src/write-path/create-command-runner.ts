import { type HybridClock, hybridClock } from '../clock/hybrid-clock.ts';
import { acceptAsyncCommand } from '../effects/accept-async-command.ts';
import { refuseReservedCommandId } from '../ids/refuse-reserved-command-id.ts';
import type { CommandRunner } from '../invoker/command-runner.ts';
import { commandReceiptId } from './command-receipt-id.ts';
import { defaultNodeId } from './default-node-id.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';
import { isRecordedFailure } from './is-recorded-failure.ts';
import { receiptScopeId } from './receipt-scope-id.ts';
import { recordFailedReceipt } from './record-failed-receipt.ts';
import { registryBehaviours } from './registry-behaviours.ts';
import { runCommand } from './run-command.ts';
import type { RunCommandInput } from './run-command-input.ts';

/** What the runtime wires the write path with. */
export interface CommandRunnerOptions {
  /** The deployment id, the scope id of deployment-scope receipts (S-69); part of an accepted command's `receiptId`. */
  readonly deploymentId: string;
  /** Overrides the entity behaviour; default: what the registry records on each `EntityEntry` (F-10 change note, WP-43). */
  readonly behaviours?: (app: string) => EntityBehaviours;
  /** The process's clock node id (section 14.5.3). */
  readonly nodeId?: string;
  /** The process clock (section 14.5.3); default: one clock for this runner, with `nodeId`. */
  readonly hybridClock?: HybridClock;
  readonly retry?: RunCommandInput['retry'];
  readonly replace?: RunCommandInput['replace'];
}

/**
 * The `CommandRunner` the invoker's execute stage calls for a command (`InvokerOptions.commands`):
 * it maps what the stage hands over to `runCommand`, or, for an asynchronous command (an `async`
 * one, or an `either` one the caller prefers to run asynchronously), to `acceptAsyncCommand`.
 */
export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const processClock = options.hybridClock ?? hybridClock(options.nodeId ?? defaultNodeId);
  return (run) => {
    const { invocation } = run;
    const job = invocation.carrier.job;
    // Before any receipt is written, so a refused id is never recorded or claimed.
    if (job === undefined) {
      try {
        refuseReservedCommandId(invocation.commandId);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const input: RunCommandInput = {
      registry: run.registry,
      adapter: run.target.handle.adapter,
      namespace: run.target.namespace,
      scope: run.target.scope,
      action: run.action,
      input: run.input,
      principal: run.session.principal,
      request: run.request,
      ...(run.config === undefined ? {} : { config: run.config }),
      clock: run.clock,
      keys: run.keys,
      compute: run.compute,
      log: run.log,
      trace: run.span,
      rules: run.rules,
      flags: run.flags,
      apiVersion: run.session.apiVersion,
      build: run.build,
      behaviours: options.behaviours?.(run.session.app) ?? registryBehaviours(run.registry),
      correlationId: invocation.requestId,
      signal: job === undefined ? run.signal : AbortSignal.any([run.signal, job.signal]),
      ...(job === undefined ? {} : { job }),
      ...(invocation.commandId === undefined ? {} : { commandId: invocation.commandId }),
      ...(invocation.sync === undefined
        ? {}
        : { client: { id: invocation.sync.clientId, seq: invocation.sync.clientSeq } }),
      ...(invocation.traceparent === undefined ? {} : { traceparent: invocation.traceparent }),
      ...(run.epoch === undefined ? {} : { epoch: run.epoch }),
      ...(run.concurrentUnits === undefined ? {} : { concurrentUnits: run.concurrentUnits }),
      ...(run.namespaceOf === undefined ? {} : { namespaceOf: run.namespaceOf }),
      hybridClock: processClock,
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      ...(options.replace === undefined ? {} : { replace: options.replace }),
    };
    const { execution } = run.action;
    const deferred =
      job === undefined &&
      (execution === 'async' || (execution === 'either' && invocation.prefer === 'async'));
    if (deferred) {
      return acceptAsyncCommand(input).then((result) =>
        result.receipt === undefined
          ? result
          : {
              ...result,
              receiptId: commandReceiptId(
                receiptScopeId(run.target.scope, options.deploymentId),
                result.receipt.commandId,
              ),
            },
      );
    }
    return runCommand(input).catch(async (error: unknown) => {
      // A deterministic refusal after the unit rolled back is pinned to the command id (15.1.7); a
      // job's worker records its failure itself, in the unit that completes the job.
      if (job === undefined && invocation.commandId !== undefined && isRecordedFailure(error)) {
        await recordFailedReceipt(input, invocation.commandId, error).catch(() => undefined);
      }
      throw error;
    });
  };
}
