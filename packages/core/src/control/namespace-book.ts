import { errors } from '../errors/errors.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { ControlStore } from './control-store.ts';
import { findControlRows } from './find-control-rows.ts';
import { namespaceRootOf } from './namespace-root-of.ts';
import { runControlCommand } from './run-control-command.ts';

/** The namespaces of the deployment's `shared-tables` placements, one per placement and app, recorded as `core.namespace` rows. */
export interface NamespaceBook {
  /** The namespace of an app on a placement (by name); created, recorded and provisioned on first use. */
  namespaceOf(placement: string, appId: string): Promise<NamespaceRef>;
}

/** What the book needs besides the control store. */
export interface NamespaceBookOptions {
  readonly store: ControlStore;
  /** Placement name to the row id `registerPlacements` answered. */
  readonly placementIds: ReadonlyMap<string, string>;
  /** Creates the namespace's tables; called once per namespace and process. */
  readonly provision: (namespace: NamespaceRef) => Promise<void>;
}

/** Builds the book; the namespaces found or created are cached for the life of the process. */
export function createNamespaceBook(options: NamespaceBookOptions): NamespaceBook {
  const known = new Map<string, Promise<NamespaceRef>>();
  const open = async (placement: string, appId: string): Promise<NamespaceRef> => {
    const placementId = options.placementIds.get(placement);
    if (placementId === undefined) {
      throw errors.not_found(`The deployment has no placement "${placement}".`);
    }
    const rows = await findControlRows(options.store, 'core.namespace', { placementId, appId });
    let id = rows.find((row) => row.tenantId === undefined || row.tenantId === null)?.id;
    if (id === undefined) {
      let created = '';
      await runControlCommand(options.store, 'namespace.register', (ctx) => {
        const draft = ctx.write.core.namespace.create({
          placementId: placementId as never,
          appId,
          root: namespaceRootOf(appId),
        });
        created = draft.id;
        return [draft];
      });
      id = created;
    }
    const namespace: NamespaceRef = {
      id: String(id),
      placementId: placement,
      appId,
      tenantId: null,
      root: namespaceRootOf(appId),
    };
    await options.provision(namespace);
    return namespace;
  };
  return {
    namespaceOf: (placement, appId) => {
      const key = `${placement}/${appId}`;
      const cached = known.get(key);
      if (cached !== undefined) return cached;
      const opened = open(placement, appId);
      known.set(key, opened);
      opened.catch(() => known.delete(key));
      return opened;
    },
  };
}
