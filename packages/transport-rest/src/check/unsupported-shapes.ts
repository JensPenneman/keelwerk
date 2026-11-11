import { type ApiSurface, hasProjectableInput, type TransportProblem } from '@keelwerk/core';
import { restProblem } from './rest-problem.ts';

/** What the document cannot describe: an entity action without its entity, an input that is neither a shape, a foreign schema nor void, and a declared error the surface does not list. */
export function unsupportedShapes(surface: ApiSurface): readonly TransportProblem[] {
  const problems: TransportProblem[] = [];
  for (const action of surface.actions) {
    if (
      action.mount === 'entity' &&
      !surface.entities.some((entity) => entity.ref === action.entity)
    ) {
      problems.push(
        restProblem(
          'unsupportedShape',
          action.ref,
          `${action.ref} is mounted on an entity the surface does not list`,
        ),
      );
    }
    if (!hasProjectableInput(action)) {
      problems.push(
        restProblem(
          'unsupportedShape',
          action.ref,
          `the input of ${action.ref} is a ${action.input.kind} field; wrap it in a shape`,
        ),
      );
    }
    for (const code of action.errors) {
      if (!surface.errors.some((error) => error.code === code)) {
        problems.push(
          restProblem(
            'unknownError',
            action.ref,
            `${action.ref} declares the error ${code}, which the surface does not list`,
          ),
        );
      }
    }
  }
  return problems;
}
