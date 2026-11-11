import type { TransportProblem } from '@keelwerk/core';
import type { GraphqlProjection } from './graphql-projection.ts';

/** The schema as built, with every problem the build met (section 16.3.2); the projection is only fit to serve when `problems` is empty. */
export interface GraphqlSchemaDraft {
  readonly projection: GraphqlProjection;
  readonly problems: readonly TransportProblem[];
}
