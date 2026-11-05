import type {
  DataAdapter,
  DeploymentDefinition,
  NamespaceRef,
  SurfaceSource,
} from '@keelwerk/core';
import type { OpenedPlacement } from './opened-placement.ts';

/** A deployment with its adapters connected, for the data commands that run against it. */
export interface OpenedDeployment {
  readonly definition: DeploymentDefinition;
  readonly apps: readonly SurfaceSource[];
  /** The id recorded in the control root; undefined while the deployment has never started. */
  readonly deploymentId: string | undefined;
  readonly control: {
    readonly adapter: DataAdapter;
    readonly namespace: NamespaceRef;
    readonly dialect: string;
  };
  readonly placements: readonly OpenedPlacement[];
  /** Closes every adapter. */
  close(): Promise<void>;
}
