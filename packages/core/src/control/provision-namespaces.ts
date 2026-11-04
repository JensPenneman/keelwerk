import type { JobGroup } from '../jobs/job-group.ts';
import type { Registry } from '../registry/registry.ts';
import type { SchemaPlanner } from '../runtime/schema-planner.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import { snapshotsOf } from './snapshots-of.ts';

/** Creates the namespace's root, framework tables, the tables of the registry's entities and the job groups; idempotent (section 14.6.7). */
export async function provisionNamespace(input: {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly planner: SchemaPlanner;
  readonly registry: Registry;
  /** 'control': the deployment-tenancy entities of the core; 'app': everything of tenant or backend tenancy. */
  readonly level: 'control' | 'app';
  /** The namespace-wide job groups the deployment declares (F-03 change note, WP-36). */
  readonly jobGroups: readonly JobGroup[];
}): Promise<void> {
  await input.adapter.schema.provision(input.namespace, snapshotsOf(input), {
    jobGroups: input.jobGroups,
  });
}
