import type { ApiSurface, TransportProblem } from '@keelwerk/core';
import { fixedTypeNames } from '../schema/fixed-type-names.ts';
import { isProjected } from '../schema/is-projected.ts';
import { graphqlProblem } from './graphql-problem.ts';
import { plannedNames } from './planned-names.ts';

const commandMembers = ['commandId', 'prefer'] as const;

/**
 * Names the schema keeps for itself: the `commandId` and `prefer` members of a command's input, the
 * root fields `node` and `nodes`, the fixed types, a name that starts with `__`, and the members
 * `code` and `message` that every error type has.
 */
export function reservedNames(surface: ApiSurface): readonly TransportProblem[] {
  const problems: TransportProblem[] = [];
  const planned = plannedNames(surface);
  for (const action of surface.actions.filter(isProjected)) {
    if (action.kind === 'command' && action.input.kind === 'shape') {
      for (const member of commandMembers) {
        if (Object.hasOwn(action.input.fields, member)) {
          problems.push(
            graphqlProblem(
              'reservedName',
              action.ref,
              `The input member '${member}' is reserved: every GraphQL command input has it. Rename the member.`,
            ),
          );
        }
      }
    }
  }
  for (const { name, subject } of planned.queryFields) {
    if (name === 'node' || name === 'nodes') {
      problems.push(
        graphqlProblem(
          'reservedName',
          subject,
          `The root field '${name}' is reserved for the Node lookup. Set hints.graphql.field to another name.`,
        ),
      );
    }
  }
  for (const { name, subject } of planned.types) {
    if (fixedTypeNames.has(name) || name.startsWith('__')) {
      problems.push(
        graphqlProblem(
          'reservedName',
          subject,
          `The type name '${name}' is reserved. Set hints.graphql.type on the action, or rename it.`,
        ),
      );
    }
  }
  for (const error of surface.errors) {
    if (error.data?.kind !== 'shape') continue;
    for (const member of ['code', 'message']) {
      if (Object.hasOwn(error.data.fields, member)) {
        problems.push(
          graphqlProblem(
            'reservedName',
            error.code,
            `The data member '${member}' is reserved: every GraphQL error type has it. Rename the member.`,
          ),
        );
      }
    }
  }
  return problems;
}
