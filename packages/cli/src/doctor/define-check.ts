import {
  checkOf,
  type DeploymentCheck,
  type Needs,
  type NeedsLiteral,
  type ValuesOf,
} from './deployment-check.ts';
import type { DoctorFinding } from './doctor-finding.ts';

/**
 * A check over deployment-wide facts. `judge` receives the plain values of the facts in `needs`
 * and nothing else, so it cannot default a fact that is missing: the runner writes 'not-checked'
 * for it instead. `applies` says whether the check has anything to look at.
 */
export function defineCheck<const N extends Needs>(spec: {
  readonly group: string;
  readonly name: string;
  readonly needs: NeedsLiteral<N>;
  readonly applies?: (values: ValuesOf<N>) => boolean;
  readonly judge: (values: ValuesOf<N>) => readonly DoctorFinding[];
}): DeploymentCheck {
  return checkOf({ kind: 'judged', ...spec, applies: spec.applies });
}
