import { type HybridClock, hybridClock } from '../clock/hybrid-clock.ts';
import type { CommandRunner } from '../invoker/command-runner.ts';
import { defaultNodeId } from './default-node-id.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';
import { runCommand } from './run-command.ts';
import type { RunCommandInput } from './run-command-input.ts';

/** What the runtime wires the write path with. */
export interface CommandRunnerOptions {
  /** The entity behaviour of an app (`entityBehavioursOf` over its modules). */
  readonly behaviours: (app: string) => EntityBehaviours;
  /** The process's clock node id (section 14.5.3). */
  readonly nodeId?: string;
  /** The process clock (section 14.5.3); default: one clock for this runner, with `nodeId`. */
  readonly hybridClock?: HybridClock;
  readonly retry?: RunCommandInput['retry'];
  readonly replace?: RunCommandInput['replace'];
}

/**
 * The `CommandRunner` the invoker's execute stage calls for a command (`InvokerOptions.commands`):
 * it maps what the stage hands over to `runCommand`.
 */
export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const processClock = options.hybridClock ?? hybridClock(options.nodeId ?? defaultNodeId);
  return (run) => {
    const { invocation } = run;
    return runCommand({
      registry: run.registry,
      adapter: run.target.handle.adapter,
      namespace: run.target.namespace,
      scope: run.target.scope,
      action: run.action,
      input: run.input,
      principal: run.session.principal,
      request: run.request,
      clock: run.clock,
      keys: run.keys,
      compute: run.compute,
      log: run.log,
      trace: run.span,
      rules: run.rules,
      apiVersion: run.session.apiVersion,
      build: run.build,
      behaviours: options.behaviours(run.session.app),
      correlationId: invocation.requestId,
      signal: run.signal,
      ...(invocation.commandId === undefined ? {} : { commandId: invocation.commandId }),
      ...(invocation.sync === undefined
        ? {}
        : { client: { id: invocation.sync.clientId, seq: invocation.sync.clientSeq } }),
      ...(invocation.traceparent === undefined ? {} : { traceparent: invocation.traceparent }),
      ...(run.concurrentUnits === undefined ? {} : { concurrentUnits: run.concurrentUnits }),
      ...(run.namespaceOf === undefined ? {} : { namespaceOf: run.namespaceOf }),
      hybridClock: processClock,
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      ...(options.replace === undefined ? {} : { replace: options.replace }),
    });
  };
}
