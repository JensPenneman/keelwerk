import { validateSchema } from 'graphql';
import type { GraphqlProjection } from './graphql-projection.ts';

/**
 * Throws a `TypeError` for a schema graphql refuses: such an error is a defect of the projection and
 * surfaces at mount, never at the first request.
 */
export function assertValidSchema(projection: GraphqlProjection): void {
  const invalid = validateSchema(projection.schema);
  if (invalid.length > 0) {
    throw new TypeError(
      `The GraphQL schema of this surface is invalid: ${invalid.map((error) => error.message).join('; ')}`,
    );
  }
}
