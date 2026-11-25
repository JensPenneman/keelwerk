import type { AdapterCapabilities } from '@keelwerk/core';
import type { DeploymentFacts } from '../../src/doctor/deployment-facts.ts';
import { known } from '../../src/doctor/known.ts';

/** Facts of a sound deployment, every one known; a case overrides what it is about. */
export function factsOf(over: Partial<DeploymentFacts> = {}): DeploymentFacts {
  return {
    socket: known(null),
    masterKey: known({ declared: true, present: true }),
    clusters: known({
      control: 'postgres://db1:5432',
      placements: [{ name: 'main', cluster: 'postgres://db2:5432' }],
    }),
    ledgerSinks: known(1),
    controlReachable: known({ reachable: true, detail: 'answered' }),
    hookFailures: known({ failures: [], olderUnread: false }),
    processes: known([]),
    bumpedMarks: known([]),
    heldTenants: known([]),
    registries: known([]),
    personalFields: known([]),
    sqlNeeds: known([]),
    fallbackReporter: known(undefined),
    capabilitiesUsed: known(undefined),
    placements: [],
    ...over,
  };
}

/** Capabilities with only the members a case names; the rest is what the case never reads. */
export function capabilitiesOf(over: object): AdapterCapabilities {
  return over as AdapterCapabilities;
}
