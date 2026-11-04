import type { NamespaceBook } from '../control/namespace-book.ts';
import { createNamespaceBook } from '../control/namespace-book.ts';
import type { ScopeDirectoryCache } from '../control/scope-directory-cache.ts';
import { createScopeDirectoryCache } from '../control/scope-directory-cache.ts';
import { errors } from '../errors/errors.ts';
import type { JobGroup } from '../jobs/job-group.ts';
import type { Composed } from './compose-phase.ts';
import type { Connected } from './connected.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import { prepareNamespace } from './prepare-namespace.ts';
import type { ServedApp } from './served-app.ts';

/** The namespace-wide job groups of the deployment's queues (`queues.<q>.running`, section 9.5.5). */
function jobGroupsOf(deployment: DeploymentDefinition): readonly JobGroup[] {
  return Object.entries(deployment.queues ?? {}).flatMap(([queue, limits]) =>
    limits.running === undefined
      ? []
      : [{ id: `queue:${queue}`, concurrency: limits.running, scope: 'namespace' as const }],
  );
}

/** What `migrate` leaves: the namespace book and the scope directory over the control store. */
export interface Migrated {
  readonly book: NamespaceBook;
  readonly directory: ScopeDirectoryCache;
}

/**
 * `migrate` (section 3.3): records and prepares the namespace of every served app on every
 * placement that hosts it, and builds the scope directory. Namespaces of backends created later
 * are prepared the first time the directory meets them.
 */
export async function migratePhase(input: {
  readonly deployment: DeploymentDefinition;
  readonly composed: Composed;
  readonly served: readonly ServedApp[];
  readonly connected: Connected;
  readonly development: boolean;
}): Promise<Migrated> {
  const { deployment, connected, served } = input;
  const jobGroups = jobGroupsOf(deployment);
  const book = createNamespaceBook({
    store: connected.control,
    placementIds: connected.placementIds,
    provision: async (namespace) => {
      const handle = connected.placements.get(namespace.placementId);
      const app = served.find((candidate) => candidate.id === namespace.appId);
      if (handle === undefined || app === undefined) {
        throw errors.unavailable(
          `App "${namespace.appId}" on placement "${namespace.placementId}" is not served by this process.`,
        );
      }
      await prepareNamespace({
        planner: input.composed.infrastructure.planner,
        adapter: handle.adapter,
        namespace,
        app,
        tracks: connected.tracks,
        development: input.development,
        jobGroups,
      });
    },
  });
  for (const [name, placement] of Object.entries(deployment.placements)) {
    const hosted = Array.isArray(placement.apps)
      ? (placement.apps as readonly string[])
      : undefined;
    for (const app of served) {
      if (hosted === undefined || hosted.includes(app.id)) await book.namespaceOf(name, app.id);
    }
  }
  const directory = createScopeDirectoryCache({
    store: connected.control,
    book,
    log: connected.log,
  });
  connected.bindDirectory(directory.lookup);
  return { book, directory };
}
