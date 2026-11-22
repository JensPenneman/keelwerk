import {
  checkOf,
  type DeploymentCheck,
  type Needs,
  type NeedsLiteral,
  type ValuesOf,
} from './deployment-check.ts';

/** A check that no source in the repository feeds: the runner prints a note with its reason and calls nothing. */
export function unfedCheck<const N extends Needs>(spec: {
  readonly group: string;
  readonly name: string;
  readonly needs: NeedsLiteral<N>;
  readonly applies?: (values: ValuesOf<N>) => boolean;
  readonly reason: string;
}): DeploymentCheck {
  return checkOf({ kind: 'unfed', ...spec, applies: spec.applies });
}
