import type { ApiSurface, TransportProblem } from '@keelwerk/core';
import { draftGraphqlSchema } from '../schema/draft-graphql-schema.ts';
import type { GraphqlSurfaceInspection } from './graphql-surface-inspection.ts';
import { graphqlUnsupportedShapes } from './graphql-unsupported-shapes.ts';
import { reservedNames } from './reserved-names.ts';
import { unknownErrors } from './unknown-errors.ts';

function order(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Looks at a surface the way the mount does (section 16.3.2): the cheap checks first (an input
 * kind or entity the projection cannot take, an error code the surface does not list, a reserved
 * name); when any of them finds something, those problems alone. Otherwise the real build, whose
 * problems (name collisions among types, fields, arguments and enum values, names GraphQL cannot
 * hold) are deduplicated and sorted by code, subject and message, so two processes, two API
 * versions or a shuffled surface report the same list. The projection comes back only when there
 * is no problem, so a surface is built once for the check and the mount.
 */
export function inspectGraphqlSurface(surface: ApiSurface): GraphqlSurfaceInspection {
  const cheap = [
    ...graphqlUnsupportedShapes(surface),
    ...unknownErrors(surface),
    ...reservedNames(surface),
  ];
  if (cheap.length > 0) return { problems: cheap };
  const draft = draftGraphqlSchema(surface);
  const unique = new Map<string, TransportProblem>();
  for (const problem of draft.problems) {
    unique.set(JSON.stringify([problem.code, problem.subject, problem.message]), problem);
  }
  const problems = [...unique.values()].sort(
    (a, b) => order(a.code, b.code) || order(a.subject, b.subject) || order(a.message, b.message),
  );
  return problems.length > 0 ? { problems } : { problems, projection: draft.projection };
}
