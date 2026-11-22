import type { DeploymentDefinition, Registry } from '@keelwerk/core';
import type { ControlReader } from './control-reader.ts';
import type { PlacementFacts } from './deployment-facts.ts';

/** What doctor is given about a deployment. */
export interface DeploymentInput {
  readonly definition: DeploymentDefinition;
  /** The environment the secrets and `env()` references resolve against. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The file mode of a path, undefined when it does not exist. */
  readonly modeOf: (path: string) => Promise<number | undefined>;
  /** The composed registries of the selected apps, for the personal-data pass and the fallbacks they use. */
  readonly registries: readonly Registry[];
  /** Every placement, the control store first (named `control`), with the apps it hosts and what its adapter does natively or why doctor could not open it. */
  readonly placements: readonly PlacementFacts[];
  /** The control store's rows; undefined while doctor reads none. */
  readonly reader: ControlReader | undefined;
}
