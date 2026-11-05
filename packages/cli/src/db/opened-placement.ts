import type { DataAdapter } from '@keelwerk/core';

/** A placement of the deployment with its adapter connected. */
export interface OpenedPlacement {
  readonly name: string;
  readonly adapter: DataAdapter;
  readonly dialect: string;
  /** The apps whose namespaces it hosts; undefined: all of them. */
  readonly apps: readonly string[] | undefined;
}
