import type { DeploymentDefinition, FallbackReporter } from '@keelwerk/core';
import { absent } from '../../src/doctor/absent.ts';
import type { DeploymentInput } from '../../src/doctor/deployment-input.ts';
import type { DoctorFinding } from '../../src/doctor/doctor-finding.ts';
import { keyEnvironment } from './deployment-definition-of.ts';
import { placementsOf } from './placements-of.ts';

/** A ledger sink that counts how often it was read. */
export const sink = (counter: { reads: number } = { reads: 0 }) => ({
  id: 's',
  append: async () => undefined,
  read: async function* () {
    counter.reads += 1;
    yield* [];
  },
});

/** A fallback reporter that finds no row. */
export const noRows: FallbackReporter = {
  kind: 'fallbackReporter',
  provides: [],
  report: () => [],
};

/** What doctor is given about a deployment: its placements as production lists them, none of them opened, and no reader. */
export const input = (
  definition: DeploymentDefinition,
  over: Partial<DeploymentInput> = {},
): DeploymentInput => ({
  definition,
  env: keyEnvironment,
  modeOf: async () => 0o600,
  registries: [],
  placements: placementsOf(definition),
  reader: absent('the control store is not read', 'nothing to do'),
  ...over,
});

export const notChecked = (found: readonly DoctorFinding[]) =>
  found.filter((finding) => finding.severity === 'not-checked');

/** The notes of the checks no source feeds: doctor says it does not check them. */
export const unfedNotes = (found: readonly DoctorFinding[]) =>
  found.filter(
    (finding) => finding.severity === 'note' && finding.message.startsWith(unfedMessageStart),
  );

export const unfedMessageStart = 'doctor does not check this: ';

/** What doctor judged: neither a check that did not run nor a note that doctor does not check something. */
export const judged = (found: readonly DoctorFinding[]) =>
  found.filter(
    (finding) =>
      finding.severity !== 'not-checked' && !finding.message.startsWith(unfedMessageStart),
  );
