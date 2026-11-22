import {
  checkOf,
  type DeploymentCheck,
  type Needs,
  type NeedsLiteral,
  type OpenPlacement,
  type ValuesOf,
} from './deployment-check.ts';
import type { PlacementFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';

/** A check run once per placement doctor could open; `concerns` leaves out the placements it has nothing to say about. */
export function definePlacementCheck<const N extends Needs>(spec: {
  readonly group: string;
  readonly name: string;
  readonly needs: NeedsLiteral<N>;
  readonly concerns?: (values: ValuesOf<N>, placement: PlacementFacts) => boolean;
  readonly judge: (values: ValuesOf<N>, placement: OpenPlacement) => readonly DoctorFinding[];
}): DeploymentCheck {
  return checkOf({ kind: 'placement', ...spec, concerns: spec.concerns });
}
