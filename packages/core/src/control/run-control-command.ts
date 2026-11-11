import { trace } from '@opentelemetry/api';
import { effectiveRules } from '../authorization/effective-rules.ts';
import type { DecideContext } from '../contexts/decide-context.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import type { CoreBase } from '../core-module/core-base-type.ts';
import { shape } from '../fields/shape.ts';
import type { SystemPrincipal } from '../principals/system-principal.ts';
import type { Decision } from '../protocol/decision.ts';
import type { Gen } from '../protocol/gen.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { runCommand } from '../write-path/run-command.ts';
import type { ControlStore } from './control-store.ts';

const system: SystemPrincipal = {
  kind: 'system',
  reason: 'the runtime writes the control store',
  scope: { backend: null, tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'core.system',
  ref: null,
};

/** What a control command decides: drafts for the core's entities, in the control store's deployment scope. */
export type ControlDecide = (ctx: DecideContext<CoreBase>) => Decision | Gen<Decision>;

/**
 * Runs a decision of the core module in the control store as the kernel: the same write path a
 * generated action takes (events with the hash chain, state rows, inline reactions such as
 * `core.syncDomains`), without the pipeline in front. The command is named `core.<name>` in the
 * events' provenance. A failure is thrown as the write path throws it.
 */
export async function runControlCommand(
  store: ControlStore,
  name: string,
  decide: ControlDecide,
): Promise<void> {
  const action: ActionEntry = {
    ref: `core.${name}`,
    module: 'core',
    name,
    mount: 'module',
    kind: 'command',
    instance: false,
    input: shape({}),
    output: shape({}),
    errors: [],
    auth: 'policy',
    scope: 'deployment',
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: coreApiVersions.dates[0] ?? '',
    changedIn: [],
    handler: (_input: unknown, ctx: unknown) => decide(ctx as DecideContext<CoreBase>),
  };
  const { registry } = store;
  const span = trace.getTracer('keelwerk').startSpan(`keelwerk.control.${name}`);
  try {
    await runCommand({
      registry,
      adapter: store.adapter,
      namespace: store.namespace,
      scope: { level: 'deployment' },
      action,
      input: {},
      principal: system,
      request: { transport: 'runtime', requestId: globalThis.crypto.randomUUID() },
      clock: store.clock,
      keys: store.keys,
      compute: store.compute,
      log: store.log,
      trace: span,
      rules: effectiveRules(registry),
      apiVersion: coreApiVersions.dates[0] ?? '',
      build: store.writer.build,
      behaviours: registryBehaviours(registry),
      hybridClock: store.writer.hybridClock,
      concurrentUnits: store.capabilities.processes !== 'single',
    });
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}
