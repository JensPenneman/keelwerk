import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { Empty } from '../types/empty.ts';
import type { AdapterEnvironment } from './adapter-environment.ts';
import type { DataAdapter } from './data-adapter.ts';
import type { PlacementConfig } from './placement-config.ts';

/** An adapter as a deployment lists it (section 14.3.2). */
export interface DataAdapterFactory {
  /** Matches `adapter` of a placement in `defineDeployment`. */
  readonly id: string;
  readonly dialect: 'postgres' | 'mysql' | 'sqlite' | 'memory' | (string & Empty);
  /** Adapter-specific placement options, validated at boot. */
  readonly options: StandardSchemaV1;
  create(placement: PlacementConfig, env: AdapterEnvironment): DataAdapter;
}
