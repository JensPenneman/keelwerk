import { type ApiSurface, hasProjectableInput, type TransportProblem } from '@keelwerk/core';
import { actionTypeName } from '../schema/action-type-name.ts';
import { isGraphqlName } from '../schema/is-graphql-name.ts';
import { isProjected } from '../schema/is-projected.ts';
import { graphqlProblem } from './graphql-problem.ts';

/**
 * What the schema cannot carry (S-153): a custom input that is neither a shape, a foreign schema
 * nor void (`hasProjectableInput`), an entity action whose entity the surface lacks and an action
 * whose type name (the `graphql.type` hint, else the Pascal form of its root field) is no GraphQL
 * name; every type the action makes starts with that name. An enum
 * value that is no GraphQL name is found by the build itself, where the enum is made.
 */
export function graphqlUnsupportedShapes(surface: ApiSurface): readonly TransportProblem[] {
  const problems: TransportProblem[] = [];
  const entities = new Set(surface.entities.map((entity) => entity.ref));
  for (const action of surface.actions.filter(isProjected)) {
    if (!hasProjectableInput(action)) {
      problems.push(
        graphqlProblem(
          'unsupportedShape',
          action.ref,
          `The input is a ${action.input.kind}; GraphQL takes a shape, a foreign schema or no input. Declare the input as a shape, or hide the action with hints.graphql.expose: false.`,
        ),
      );
    }
    const typeName = actionTypeName(action);
    if (!isGraphqlName(typeName)) {
      problems.push(
        graphqlProblem(
          'unsupportedShape',
          action.ref,
          `The type name '${typeName}' is no GraphQL name: it starts with a letter or an underscore and holds letters, digits and underscores. Set hints.graphql.type, or hints.graphql.field, to a name that does.`,
        ),
      );
    }
    if (action.entity !== undefined && !entities.has(action.entity)) {
      problems.push(
        graphqlProblem(
          'unsupportedShape',
          action.ref,
          `The action belongs to the entity ${action.entity}, which the surface does not have.`,
        ),
      );
    }
  }
  return problems;
}
