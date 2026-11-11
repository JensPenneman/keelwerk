import type { ApiSurface, TransportProblem } from '@keelwerk/core';
import { isProjected } from '../schema/is-projected.ts';
import { graphqlProblem } from './graphql-problem.ts';

/** A declared error code the surface does not list: the result union cannot name its type. */
export function unknownErrors(surface: ApiSurface): readonly TransportProblem[] {
  const known = new Set(surface.errors.map((error) => error.code));
  return surface.actions
    .filter(isProjected)
    .flatMap((action) =>
      action.errors
        .filter((code) => !known.has(code))
        .map((code) =>
          graphqlProblem(
            'unknownError',
            action.ref,
            `The action declares the error ${code}, which the surface does not list.`,
          ),
        ),
    );
}
