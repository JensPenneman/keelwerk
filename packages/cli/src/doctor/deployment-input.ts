import type { AdapterCapabilities, DeploymentDefinition, Registry } from '@keelwerk/core';
import type { ControlReader } from './control-reader.ts';
import type { SqlNeedFact } from './deployment-facts.ts';

/** What doctor is given about a deployment. */
export interface DeploymentInput {
  readonly definition: DeploymentDefinition;
  /** The environment the secrets and `env()` references resolve against. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The file mode of a path, undefined when it does not exist. */
  readonly modeOf: (path: string) => Promise<number | undefined>;
  /** The composed registries of the selected apps, for the personal-data pass and the fallbacks they use. */
  readonly registries: readonly Registry[];
  /** What each placement's adapter does natively, when the adapter was opened. Placement `control` is the control store. */
  readonly capabilities: ReadonlyMap<string, AdapterCapabilities>;
  readonly reader: ControlReader | undefined;
  /** Modules that declare `data.needs` (section 14.3.8); none can until the declaration exists. */
  readonly sqlNeeds?: readonly SqlNeedFact[];
}
