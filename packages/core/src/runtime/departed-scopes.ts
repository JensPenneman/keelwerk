import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Connected } from './connected.ts';

/**
 * The scope ids among `scopeIds` that the directory does not place in `namespaceId` (14.7.6): the
 * deployment id when the namespace is not the control namespace, a backend or tenant whose record
 * names another namespace, and an id with neither record. A mark of such a scope has no counter row
 * here because the scope lives elsewhere (it moved, or it was removed), not because a restore lost
 * the row, so the restore check leaves it alone. A lookup that fails is not caught: the start fails
 * like any other failure of the check.
 */
export async function departedScopes(input: {
  readonly connected: Pick<Connected, 'control' | 'deploymentId'>;
  readonly directory: ScopeLookup;
  readonly namespaceId: string;
  readonly scopeIds: Iterable<string>;
}): Promise<ReadonlySet<string>> {
  const { connected, directory, namespaceId } = input;
  const departed = new Set<string>();
  for (const id of input.scopeIds) {
    if (id === connected.deploymentId) {
      if (namespaceId !== connected.control.namespace.id) departed.add(id);
      continue;
    }
    const backend = await directory.backend(id);
    if (backend !== undefined) {
      if (backend.namespace.id !== namespaceId) departed.add(id);
      continue;
    }
    const tenant = await directory.tenant(id);
    if (tenant === undefined || tenant.namespace.id !== namespaceId) departed.add(id);
  }
  return departed;
}
