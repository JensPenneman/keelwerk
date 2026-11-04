import type { AdapterCapabilities } from './adapter-capabilities.ts';
import type { ChangeFeedSource } from './change-feed-source.ts';
import type { NamespaceRef } from './namespace-ref.ts';
import type { SchemaOperations } from './schema-operations.ts';
import type { StorageScope } from './storage-scope.ts';
import type { Unit } from './unit.ts';
import type { UnitOptions } from './unit-options.ts';

/** The only coupling between application code and a datastore (section 14.3.2). */
export interface DataAdapter {
  readonly placementId: string;
  /** Opens pools; returns capabilities narrowed by the server version and settings. */
  connect(): Promise<AdapterCapabilities>;
  close(deadlineMs: number): Promise<void>;
  health(): Promise<{ readonly ok: boolean; readonly detail?: string }>;
  /** One transaction on one namespace for one scope. Nesting goes through `Unit.nested`. */
  unit<T>(
    namespace: NamespaceRef,
    scope: StorageScope,
    fn: (u: Unit) => Promise<T>,
    options?: UnitOptions,
  ): Promise<T>;
  /** Section 14.6.7. */
  readonly schema: SchemaOperations;
  /** Section 15.2.5. */
  readonly feed: ChangeFeedSource;
  /** Capability `broadcast`: small payloads to every process of the deployment, for topics and presence (section 15.4.7). */
  readonly broadcast?: {
    publish(channel: string, payload: Uint8Array): Promise<void>;
    subscribe(channel: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
  };
  /** The database cluster's identity, compared at connect to detect restores (section 14.7.6). */
  identity(): Promise<{ readonly systemId: string; readonly timeline: string }>;
}
