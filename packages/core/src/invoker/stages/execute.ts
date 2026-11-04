import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import { runRead } from '../../interpreter/run-read.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Span } from '../../observability/span.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Scope } from '../../storage/scope.ts';
import type { CommandResult } from '../command-runner.ts';
import type { Invocation } from '../invocation.ts';
import type { InvocationSession } from '../invocation-session.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { RequestInfo } from '../request-info.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { SessionDetails } from '../session-details.ts';
import { withDeadline } from './with-deadline.ts';

function unavailable(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'unavailable', code: 'core.unavailable', message });
}

/** A backend-scope action of a tenant session runs in the backend's own unit, so it reaches no tenant data (section 8.8). */
function targetOf(action: ActionEntry, details: SessionDetails): ScopeTarget {
  const { resolved } = details;
  const target =
    action.scope === 'backend' && resolved.backendTarget !== null
      ? resolved.backendTarget
      : resolved.target;
  if (target === null) throw unavailable('No store is connected for this scope.');
  return target;
}

function requestInfo(invocation: Invocation<unknown>): RequestInfo {
  const { carrier } = invocation;
  const userAgent = carrier.headers?.['user-agent'];
  return {
    transport: carrier.transport,
    requestId: invocation.requestId,
    ...(carrier.connection === undefined ? {} : { connection: carrier.connection }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

/** What the execute stage runs. */
export interface ExecuteInput {
  readonly action: ActionEntry;
  /** The validated, translated input. */
  readonly value: unknown;
  readonly invocation: Invocation<unknown>;
  readonly session: InvocationSession;
  readonly details: SessionDetails;
  readonly span: Span;
  readonly log: Logger;
}

/** What the execute stage answered, and the scope it ran in (a backend action of a tenant session runs in the backend's). */
export interface Executed extends CommandResult {
  readonly scope: Scope;
}

/**
 * `execute` (section 9.2). A query is driven by `runRead` in a read-only unit of the action's
 * scope, and a client disconnect or the deadline aborts the signal `runRead` receives, which ends
 * the read-only unit. A command goes to the write path the runtime wires
 * in; a disconnect never reaches it, only its timeout does (section 16.4.11). Both fail with
 * `unavailable` `core.timeout` past the action's `timeoutMs`.
 */
export async function execute(env: InvokerEnv, input: ExecuteInput): Promise<Executed> {
  const { action, invocation, session, details } = input;
  const target = targetOf(action, details);
  if (action.kind === 'command') {
    const commands = env.options.commands;
    if (commands === undefined) {
      throw new KeelwerkError({
        kind: 'not_implemented',
        code: 'core.not_implemented',
        message: `"${action.ref}" is a command, and this release has no write path wired.`,
      });
    }
    const result = await withDeadline(
      (signal) =>
        commands({
          action,
          input: input.value,
          invocation,
          session,
          target,
          signal,
        }),
      { command: true, ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }) },
    );
    return { ...result, scope: target.scope };
  }
  if (action.kind !== 'query') {
    throw new KeelwerkError({
      kind: 'unavailable',
      code: 'core.live_unavailable',
      message: 'Live updates are not available in this release.',
    });
  }
  const { registry } = env.appOf(details.resolved.app);
  const { options } = env;
  const { capabilities } = target.handle;
  const backendNamespace = (details.resolved.backendTarget ?? target).namespace;
  const output = await withDeadline(
    async (signal) => {
      const result = await runRead({
        signal,
        registry,
        adapter: target.handle.adapter,
        namespace: target.namespace,
        scope: target.scope,
        action: action.ref,
        input: input.value,
        principal: session.principal,
        request: requestInfo(invocation),
        clock: options.clock,
        keys: options.keys,
        compute: options.compute,
        log: input.log,
        trace: input.span,
        rules: env.rulesOf(registry),
        namespaceOf: (scope) => (scope.level === 'backend' ? backendNamespace : target.namespace),
        ...(capabilities === undefined
          ? {}
          : { concurrentUnits: capabilities.processes !== 'single' }),
      });
      return result.output;
    },
    {
      clientSignal: invocation.signal,
      ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
    },
  );
  return { output, scope: target.scope };
}
