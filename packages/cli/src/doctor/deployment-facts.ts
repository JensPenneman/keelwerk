import type { AdapterCapabilities } from '@keelwerk/core';

/** The operator socket: where it is and its file mode, undefined when the file is not there. */
interface SocketFact {
  readonly path: string;
  readonly mode: number | undefined;
}

/** One scope against its newest anchor in the ledger sinks (S-35). */
interface AnchorFact {
  readonly scopeId: string;
  /** Decimal position of the newest anchor. */
  readonly anchored: string;
  readonly anchoredAt: string;
  /** Decimal head position now; undefined when the scope could not be read. */
  readonly head: string | undefined;
}

/** A placement, the control store included: which adapter, which cluster, and what the adapter does natively. */
export interface PlacementFact {
  readonly name: string;
  readonly adapter: string;
  /** Adapter and host; two placements with the same cluster share a database server. Undefined when the url cannot be resolved. */
  readonly cluster: string | undefined;
  /** Undefined when the adapter was not opened (doctor does not connect on its own). */
  readonly capabilities: AdapterCapabilities | undefined;
}

/** One row of `core.process`. */
export interface ProcessFact {
  readonly id: string;
  readonly name: string | undefined;
  readonly roles: readonly string[];
  readonly state: string;
  readonly heartbeatAgeMs: number;
}

/** A lifecycle hook that failed for a tenant and has not completed since (S-27). */
export interface HookFailureFact {
  readonly hookId: string;
  readonly tenantId: string;
}

/** A queue's depth against its caps, and how many processes work it. */
export interface QueueFact {
  readonly name: string;
  readonly queued: number;
  readonly running: number;
  readonly queuedCap: number | undefined;
  readonly runningCap: number | undefined;
  readonly workers: number;
}

/** Counters of work that is stuck (sections 9.5.5 and 21.2). */
export interface WorkFact {
  readonly deadLetters: number;
  readonly parkedStreams: number;
  readonly cappedLanes: number;
  readonly unplaceable: number;
  readonly externalTableDrift: readonly string[];
}

export interface AnchorFacts {
  /** The cadence in milliseconds; undefined for `'batch'` or when the deployment sets none. */
  readonly cadenceMs: number | undefined;
  readonly scopes: readonly AnchorFact[];
  /** Appends a ledger sink refused. */
  readonly refusedAppends: number;
}

/** A module that needs a raw-SQL dialect (`data.needs`, section 14.3.8). */
export interface SqlNeedFact {
  readonly module: string;
  readonly dialect: string;
}

/** One personal field with the declarations doctor judges (section 14.7.9.12). */
export interface PersonalFieldFact {
  readonly field: string;
  readonly kind: string;
  readonly queries: readonly string[];
  readonly keys: 'subject' | 'tenant';
  readonly normalizer: string;
  readonly prefixMin: number;
  readonly containsBits: number;
  /** The key scope of each token search index that covers the field. */
  readonly searchKeys: readonly ('subject' | 'tenant')[];
  /** Distinct values in a tenant, when the deployment was sampled. */
  readonly distinctValues: number | undefined;
  readonly indexRows: number | undefined;
  readonly indexBytes: number | undefined;
  /** Reindex jobs that failed, backups holding plaintext of the field, indexes built under another Unicode version. */
  readonly failedReindexJobs: number;
  readonly plaintextBackups: boolean;
  readonly otherUnicodeVersion: boolean;
}

/** What doctor knows of a deployment before it judges it. */
export interface DeploymentFacts {
  readonly socket: SocketFact | undefined;
  readonly masterKey: { readonly declared: boolean; readonly present: boolean };
  /** Undefined when doctor had no control store to ask. */
  readonly controlReachable: { readonly reachable: boolean; readonly detail: string } | undefined;
  readonly control: PlacementFact;
  readonly placements: readonly PlacementFact[];
  readonly ledgerSinks: number;
  readonly hookFailures: readonly HookFailureFact[];
  readonly work: WorkFact;
  readonly sqlNeeds: readonly SqlNeedFact[];
  readonly queues: readonly QueueFact[];
  readonly processes: readonly ProcessFact[];
  readonly anchors: AnchorFacts;
  readonly personal: readonly PersonalFieldFact[];
}
