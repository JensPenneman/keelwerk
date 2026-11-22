import type {
  AdapterCapabilities,
  DataAdapter,
  DataAdapterFactory,
  DeploymentDefinition,
} from '@keelwerk/core';
import { absent } from './absent.ts';
import { adapterEnvironmentOf } from './adapter-environment-of.ts';
import { couldNotOpen } from './could-not-open.ts';
import type { PlacementFacts } from './deployment-facts.ts';
import type { Fact } from './fact.ts';
import { known } from './known.ts';
import { messageOf } from './message-of.ts';
import { placementConfigOf } from './placement-config-of.ts';
import { placementFactsOf } from './placement-facts-of.ts';
import { type PlacementSlot, placementSlotsOf } from './placement-slots-of.ts';

function isFactory(value: unknown): value is DataAdapterFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'create' in value &&
    typeof value.create === 'function'
  );
}

/** The adapter id of the embedded store that only the process running it can read. */
const pgliteId = 'pglite';

/** Why doctor does not open a placement whose adapter is `pglite`. */
const pgliteReason =
  'the pglite adapter is not opened: an embedded database can be read only by the process that runs it, and its factory creates the directory and a role where they are missing';

/** What the operator can do about it: nothing, it is how doctor works. */
const pgliteFix = 'nothing to do: doctor never opens an embedded database';

/** The capabilities of a placement that connected but did not close, with the message of the close. */
function closeFailed(message: string): Fact<AdapterCapabilities> {
  return absent(
    `the placement was opened, but closing it failed: ${message}`,
    'run doctor again; if it fails the same way, check why the adapter cannot close its connection',
  );
}

/** Closes an adapter that did not connect: its failure is told after the failure that matters. */
async function closeAfterFailure(adapter: DataAdapter, failure: unknown): Promise<string> {
  try {
    await adapter.close(1000);
    return messageOf(failure);
  } catch (error) {
    return `${messageOf(failure)}; closing it failed too: ${messageOf(error)}`;
  }
}

/** What the adapter of one placement does natively, or why doctor has none: it is never opened when its id is `pglite`, and a failure to create, connect or close it is a reason, never a throw. */
async function capabilitiesOf(
  { name, entry }: PlacementSlot,
  definition: DeploymentDefinition,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Fact<AdapterCapabilities>> {
  if (entry.adapter === pgliteId) return absent(pgliteReason, pgliteFix);
  const factory = definition.infrastructure
    .filter(isFactory)
    .find((candidate) => candidate.id === entry.adapter);
  if (factory === undefined) {
    return absent(
      `no infrastructure entry provides the ${entry.adapter} adapter`,
      `add the ${entry.adapter} adapter to \`infrastructure\` in the deployment file`,
    );
  }
  const config = placementConfigOf(name, entry, env);
  if (config === undefined) {
    return absent(
      'its url reads an environment variable that is not set',
      'set the environment variable the url reads, then run doctor again',
    );
  }
  let adapter: DataAdapter;
  try {
    adapter = factory.create(config, adapterEnvironmentOf(env));
  } catch (error) {
    return couldNotOpen(messageOf(error));
  }
  let capabilities: AdapterCapabilities;
  try {
    capabilities = await adapter.connect();
  } catch (error) {
    return couldNotOpen(await closeAfterFailure(adapter, error));
  }
  try {
    await adapter.close(1000);
  } catch (error) {
    return closeFailed(messageOf(error));
  }
  return known(capabilities);
}

/**
 * Walks the placements of the deployment once, the control store first (named `control`), and
 * gives each with the apps it hosts and what its adapter does natively: its factory is found in
 * the deployment's infrastructure, its adapter is created, connected without migrating and closed
 * again, so doctor can list the fallbacks (section 14.3.3). A placement whose adapter is `pglite`
 * is never opened. A placement doctor cannot open gives the reason instead of capabilities.
 */
export async function openPlacements(
  definition: DeploymentDefinition,
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly PlacementFacts[]> {
  const opened: PlacementFacts[] = [];
  for (const slot of placementSlotsOf(definition)) {
    opened.push(placementFactsOf(slot, await capabilitiesOf(slot, definition, env)));
  }
  return opened;
}
