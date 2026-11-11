import { errors } from '../errors/errors.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Scope } from '../storage/scope.ts';
import type { ExplainEnvironment } from './explain-environment.ts';

/** The scope an explain request addresses, with the data it lives in. */
export interface ExplainTarget {
  readonly scope: Scope;
  /** The app of the scope's backend; `core` at deployment level. */
  readonly app: string;
  readonly target: ScopeTarget;
  /** The backend's own data, for a backend read from a tenant scope. */
  readonly backend: ScopeTarget | undefined;
  /** The backend's validated configuration by module id (5.7), for the enrichers of `--as`; absent at deployment scope. */
  readonly backendConfig?: Readonly<Record<string, unknown>>;
}

/**
 * Finds the data of the scope the request names. The operator's session is the deployment's;
 * `tenant` (with its backend, found from the control store) or `backend` select the scope
 * the command would run in, as the host name would for a user.
 */
export async function explainTarget(
  env: ExplainEnvironment,
  selector: { readonly backend?: string; readonly tenant?: string },
): Promise<ExplainTarget> {
  const { options } = env;
  const open = (
    placementId: string,
    namespace: ScopeTarget['namespace'],
    scope: Scope,
  ): ScopeTarget => {
    const handle = options.placement(placementId);
    if (handle === undefined) {
      throw errors.unavailable(`Placement "${placementId}" is not connected to this process.`);
    }
    return { scope, namespace, handle };
  };
  if (selector.backend === undefined && selector.tenant === undefined) {
    if (options.control === undefined) {
      throw errors.unavailable('No store is connected for this scope.');
    }
    return {
      scope: { level: 'deployment' },
      app: 'core',
      target: options.control,
      backend: undefined,
    };
  }
  const tenant =
    selector.tenant === undefined ? undefined : await options.directory.tenant(selector.tenant);
  if (selector.tenant !== undefined && tenant === undefined) {
    throw errors.not_found(`The tenant ${selector.tenant} does not exist.`);
  }
  const backendId = tenant?.backendId ?? selector.backend;
  if (selector.backend !== undefined && backendId !== selector.backend) {
    throw errors.validation(`The tenant ${selector.tenant} belongs to backend ${backendId}.`);
  }
  const backend = backendId === undefined ? undefined : await options.directory.backend(backendId);
  if (backend === undefined) throw errors.not_found(`The backend ${backendId} does not exist.`);
  const config = backend.config === undefined ? {} : { backendConfig: backend.config };
  const backendScope: Scope = { level: 'backend', backendId: backend.id };
  const backendTarget = open(backend.placementId, backend.namespace, backendScope);
  if (tenant === undefined) {
    return {
      scope: backendScope,
      app: backend.app,
      target: backendTarget,
      backend: backendTarget,
      ...config,
    };
  }
  const scope: Scope = { level: 'tenant', backendId: backend.id, tenantId: tenant.id };
  return {
    scope,
    app: backend.app,
    target: open(tenant.placementId, tenant.namespace, scope),
    backend: backendTarget,
    ...config,
  };
}
