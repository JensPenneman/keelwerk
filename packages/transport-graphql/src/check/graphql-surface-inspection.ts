import type { TransportProblem } from '@keelwerk/core';
import type { GraphqlProjection } from '../schema/graphql-projection.ts';

/** What looking at a surface found: its problems and, only when there are none, the projection that was built to find them. */
export interface GraphqlSurfaceInspection {
  readonly problems: readonly TransportProblem[];
  readonly projection?: GraphqlProjection;
}
