import type { ApiSurface } from '@keelwerk/core';
import type { YogaServerInstance } from 'graphql-yoga';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import type { GraphqlProjection } from '../schema/graphql-projection.ts';

/** What the handler serves at one API version: its surface, its schema and the Yoga instance that executes against it. */
export interface GraphqlVersionMount {
  readonly surface: ApiSurface;
  readonly projection: GraphqlProjection;
  readonly yoga: YogaServerInstance<Record<string, unknown>, GraphqlContext>;
}
