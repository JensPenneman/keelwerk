import { trace } from '@opentelemetry/api';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { errors } from '../errors/errors.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { OperatorPrincipal } from '../principals/operator-principal.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { runCommand } from '../write-path/run-command.ts';
import type { ControlStore } from './control-store.ts';

/**
 * The core's rules allow no system principal, so the runtime writes as an operator of its own
 * until the specification rules on the principal of control writes (section 17).
 */
const runtimeOperator: OperatorPrincipal = {
  kind: 'operator',
  id: 'core.runtime',
  scope: { backend: null, tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'core.system',
  ref: null,
};

/** An id answerer that hands out the pinned id, which the row about to be created already carries in sealed values. */
function pinnedId(id: string): RequestAnswerer['id'] {
  return async () => id;
}

/**
 * Runs the generated `create` of a control entity (`core.backend.create`, `core.tenant.create`) in
 * the control store as the runtime's operator: the write path a request takes, below the pipeline,
 * so the events, the item check against the entity's rules and the inline reactions are the same.
 * Answers the id of the new row; `id` pins it (the runtime's own seam, never a client's input).
 */
export async function runGeneratedCreate(
  store: ControlStore,
  entity: 'backend' | 'tenant',
  input: Readonly<Record<string, unknown>>,
  id?: string,
): Promise<{ readonly id: string }> {
  const { registry } = store;
  const action = registry.actions.get(`core.${entity}.create`);
  if (action === undefined) {
    throw errors.internal(`the control store has no generated core.${entity}.create`);
  }
  const span = trace.getTracer('keelwerk').startSpan(`keelwerk.control.${entity}.create`);
  try {
    const result = await runCommand({
      registry,
      adapter: store.adapter,
      namespace: store.namespace,
      scope: { level: 'deployment' },
      action,
      input,
      ...(id === undefined ? {} : { replace: { id: pinnedId(id) } }),
      principal: runtimeOperator,
      request: { transport: 'runtime', requestId: globalThis.crypto.randomUUID() },
      clock: store.clock,
      keys: store.keys,
      compute: store.compute,
      log: store.log,
      trace: span,
      rules: [...registry.rules.values()]
        .filter((rule) => rule.disabled !== true)
        .map(normalizeRule),
      apiVersion: coreApiVersions.dates[0] ?? '',
      build: store.writer.build,
      behaviours: registryBehaviours(registry),
      hybridClock: store.writer.hybridClock,
      concurrentUnits: store.capabilities.processes !== 'single',
    });
    return { id: String((result.output as { id: unknown }).id) };
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}
