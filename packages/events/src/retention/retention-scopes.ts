import type { RuntimeServiceContext } from '@keelwerk/core';
import { fanOutTenants } from '@keelwerk/core';
import type { RetentionScope } from './retention-scope.ts';

const levels = [{ scope: 'backend' }, { scope: 'each-tenant' }] as const;

/**
 * The scopes a pass visits: the deployment scope of the control store first, then, for every
 * namespace of the process but the control one, each backend and each tenant whose data lives
 * there (`fanOutTenants`, paged by `pageSize`). A scope is visited whether or not its backend or
 * tenant is active, archived or suspended, and whether or not a restore hold holds it: retention
 * stops only on the service signal. A backend that the directory no longer knows (an archived
 * one) has no scopes here.
 */
export async function* retentionScopes(
  context: RuntimeServiceContext,
  pageSize: number,
): AsyncGenerator<RetentionScope> {
  const { control } = context;
  yield {
    target: {
      scope: { level: 'deployment' },
      namespace: control.namespace,
      handle: { adapter: control.adapter },
    },
    registry: control.registry,
    backendId: control.deploymentId,
    tenantId: null,
  };
  for (const source of context.namespaces) {
    if (source.namespace.id === control.namespace.id) continue;
    for (const entry of levels) {
      for await (const found of fanOutTenants(
        control,
        context.directory,
        source,
        entry,
        pageSize,
        context.signal,
        { includeArchived: true },
      )) {
        yield {
          target: { scope: found.scope, namespace: source.namespace, handle: source.handle },
          registry: source.registry,
          backendId: found.backendId,
          tenantId: found.scope.level === 'tenant' ? found.scope.tenantId : null,
        };
      }
    }
  }
}
