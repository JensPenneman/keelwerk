import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import { backendQuotasOf } from '../quotas/backend-quotas-of.ts';
import { checkedQuotaValue } from '../quotas/checked-quota-value.ts';
import { limitAbove } from '../quotas/limit-above.ts';
import { resolveLimits } from '../quotas/resolve-limits.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { QuotaCheck } from './quota-check.ts';
import type { ServedApp } from './served-app.ts';

function refuse(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'validation', code: 'core.malformed_request', message });
}

/**
 * The checks of `ControlPath.checkQuota`, in this order. A tenant is named (`core.malformed_request`,
 * before any read). The backend exists (`not_found`) and its app is served here (`unavailable`). The
 * dimension and the limit pass `checkedQuotaValue` (a queue of the deployment or a quota the
 * backend's app declares, a limit that parses for its kind). A dimension counted per backend is
 * refused: its value is the backend's configuration (`config.core.quotas`). The tenant belongs to
 * the backend. `default` passes; any other limit is not above the backend's configured value, or
 * its default. Every refusal after the first two is `core.malformed_request`. Answers the text to
 * store: `default`, or the limit in its canonical form.
 */
export async function checkQuotaInput(input: {
  readonly check: QuotaCheck;
  readonly deployment: Pick<DeploymentDefinition, 'queues'>;
  readonly served: readonly ServedApp[];
  readonly control: ControlStore;
  readonly lookup: ScopeLookup;
}): Promise<string> {
  const { check, deployment, served, control, lookup } = input;
  const tenantId: unknown = check.tenantId;
  if (typeof tenantId !== 'string' || tenantId === '') {
    throw refuse("A quota value names a tenant: a backend's own values are its configuration.");
  }
  const backend = await lookup.backend(check.backendId);
  if (backend === undefined) {
    throw errors.not_found(`The backend ${check.backendId} does not exist.`);
  }
  const app = served.find((candidate) => candidate.id === backend.app);
  if (app === undefined) {
    throw errors.unavailable(`App "${backend.app}" is not served by this process.`);
  }
  const { entry, limit, canonical } = checkedQuotaValue({
    dimension: check.dimension,
    limit: check.limit,
    appId: app.id,
    registry: app.registry,
    queues: deployment.queues,
  });
  if (entry.level === 'backend') {
    throw refuse(
      `${entry.ref} is counted per backend: its value is set in the backend's configuration (config.core.quotas), not with core.quota.set.`,
    );
  }
  const tenants = await findControlRows(control, 'core.tenant', {
    id: tenantId,
    backendId: check.backendId,
  });
  if (tenants.length === 0) {
    throw refuse(`The tenant ${tenantId} does not belong to the backend ${check.backendId}.`);
  }
  if (limit === null) return canonical;
  const bound = resolveLimits({
    entry,
    scope: { level: 'backend', backendId: check.backendId },
    rows: new Map(),
    backendQuotas: new Map([[check.backendId, backendQuotasOf(backend.config)]]),
  });
  if (limitAbove(limit, bound)) {
    throw refuse(`The tenant's ${entry.ref} is above the backend's value.`);
  }
  return canonical;
}
