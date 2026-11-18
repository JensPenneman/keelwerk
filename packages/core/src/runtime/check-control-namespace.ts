import type { ControlStore } from '../control/control-store.ts';
import type { EpochBump } from '../control/epoch-bump.ts';
import { errors } from '../errors/errors.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { applyNamespace } from './apply-namespace.ts';
import { decideNamespace } from './decide-namespace.ts';

/** The directory does not exist yet in `connect`: a lookup there is a fault, and it fails the start. */
const notOpen: ScopeLookup = {
  hostname: async () => {
    throw errors.internal('The scope directory is not open yet.');
  },
  backend: async () => {
    throw errors.internal('The scope directory is not open yet.');
  },
  tenant: async () => {
    throw errors.internal('The scope directory is not open yet.');
  },
};

/**
 * Step (a) of the restore check (14.7.6) for the control namespace, run in `connect` before the
 * process writes anything to it (the process row, the placements and the namespace book are control
 * commands in the deployment scope). A control store restored to a backup a position or two below
 * the deployment scope's mark would otherwise have the boot's own writes take those positions again
 * under epoch 0 and lift the counter back to the mark, hiding the rewind for good. Compares the
 * identity, the mark and the counters of the namespace and carries the decision out; the sinks'
 * anchors are compared once more by `restoreCheck`, where the directory exists. Answers the bumps.
 */
export async function checkControlNamespace(input: {
  readonly control: ControlStore;
  readonly deploymentId: string;
  readonly clock: Clock;
  readonly log: Logger;
}): Promise<readonly EpochBump[]> {
  const { control, deploymentId, clock, log } = input;
  const source = {
    namespace: control.namespace,
    handle: { adapter: control.adapter, capabilities: control.capabilities },
    registry: control.registry,
  };
  await control.marks.bumped();
  const recorded = (await control.identities.all()).find(
    (row) => row.namespaceId === control.namespace.id,
  );
  const now = clock.now();
  const decision = await decideNamespace({
    connected: { control, deploymentId },
    control,
    source,
    directory: notOpen,
    recorded,
    anchors: new Map(),
    now,
    log,
  });
  const bumps = await applyNamespace({ control, decision, now, log });
  await control.marks.bumped();
  return bumps;
}
