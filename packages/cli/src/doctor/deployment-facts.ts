import type { AdapterCapabilities, FallbackReporter, Registry, ScopeMark } from '@keelwerk/core';
import type { Fact } from './fact.ts';

/** The operator socket: where it is and its file mode. */
interface SocketFact {
  readonly path: string;
  readonly mode: number;
}

/** The cluster of the control store and of each placement: adapter and host. */
interface ClustersFact {
  readonly control: string;
  readonly placements: readonly { readonly name: string; readonly cluster: string }[];
}

/** One row of `core.process`. */
export interface ProcessFact {
  readonly id: string;
  readonly name: string | undefined;
  readonly roles: readonly string[];
  readonly state: string;
  readonly heartbeatAgeMs: number;
}

/** A lifecycle hook that failed for a tenant and has not completed since. */
export interface HookFailureFact {
  readonly hookId: string;
  readonly tenantId: string;
}

/** A module of an app that needs a raw-SQL dialect (`data.sql`, or a `{ sql }` entry of `data.needs`). */
export interface SqlNeedFact {
  readonly app: string;
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
}

/**
 * Every deployment-wide fact a check can ask for, as a plain type. `DeploymentFacts` makes each
 * one a `Fact`, so a fact that doctor cannot get is a reason and never a default.
 */
export interface FactValues {
  /** `null` when the deployment declares no operator socket. */
  readonly socket: SocketFact | null;
  readonly masterKey: { readonly declared: boolean; readonly present: boolean };
  readonly clusters: ClustersFact;
  readonly ledgerSinks: number;
  readonly controlReachable: { readonly reachable: boolean; readonly detail: string };
  readonly hookFailures: readonly HookFailureFact[];
  readonly processes: readonly ProcessFact[];
  readonly bumpedMarks: readonly ScopeMark[];
  readonly heldTenants: readonly string[];
  readonly registries: readonly Registry[];
  readonly personalFields: readonly PersonalFieldFact[];
  readonly sqlNeeds: readonly SqlNeedFact[];
  readonly fallbackReporter: FallbackReporter | undefined;
  /** The capabilities the apps lean on; undefined when no app registry is composed. */
  readonly capabilitiesUsed: ReadonlySet<string> | undefined;
}

/** A placement, the control store included (named `control`). */
export interface PlacementFacts {
  readonly name: string;
  readonly adapter: string;
  /** The ids of the apps the placement hosts; none for the control store. */
  readonly apps: readonly string[];
  /** What the adapter does natively, when doctor could open it. */
  readonly capabilities: Fact<AdapterCapabilities>;
}

/** What doctor knows of a deployment before it judges it: every fact, each a value or a reason. */
export type DeploymentFacts = { readonly [K in keyof FactValues]: Fact<FactValues[K]> } & {
  readonly placements: readonly PlacementFacts[];
};
