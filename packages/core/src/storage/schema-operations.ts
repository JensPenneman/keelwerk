import type { AppliedMigration } from './applied-migration.ts';
import type { Catalogue } from './catalogue.ts';
import type { MigrationFile } from './migration-file.ts';
import type { MigrationStep } from './migration-step.ts';
import type { NamespaceRef } from './namespace-ref.ts';
import type { TrackSnapshot } from './track-snapshot.ts';

/** The schema contract of an adapter (section 14.6.7). */
export interface SchemaOperations {
  /** Renders neutral steps for review (`keelwerk db plan`) without running them. */
  render(namespace: NamespaceRef, steps: readonly MigrationStep[]): readonly string[];
  /** Applies one file under the namespace lock and records it; resumable where DDL is not transactional. */
  apply(namespace: NamespaceRef, file: MigrationFile): Promise<void>;
  history(namespace: NamespaceRef): Promise<readonly AppliedMigration[]>;
  /** Creates the root, the framework tables and the given track snapshots; idempotent. */
  provision(namespace: NamespaceRef, snapshots: readonly TrackSnapshot[]): Promise<void>;
  /** Reads a live catalogue: a namespace for drift checks, or any schema and table set for `db introspect`. */
  introspect(
    target:
      | { readonly namespace: NamespaceRef }
      | {
          readonly url: string;
          readonly schema?: string;
          readonly tables?: readonly string[];
        },
  ): Promise<Catalogue>;
  lock<T>(namespace: NamespaceRef, fn: () => Promise<T>): Promise<T>;
}
