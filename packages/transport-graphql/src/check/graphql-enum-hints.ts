import type { ApiSurface, SurfaceAction, TransportProblem } from '@keelwerk/core';
import { fixedTypeNames } from '../schema/fixed-type-names.ts';
import { isGraphqlName } from '../schema/is-graphql-name.ts';
import { isProjected } from '../schema/is-projected.ts';
import { isSubscribed } from '../subscriptions/is-subscribed.ts';
import { graphqlProblem } from './graphql-problem.ts';

/** Whether the schema answers the action with its entity type, so that it never builds the output shape: a generated `get` or a generated write of one row. */
function answersWithEntity(action: SurfaceAction, entities: ReadonlySet<string>): boolean {
  if (action.entity === undefined || !entities.has(action.entity)) return false;
  if (action.kind === 'query') return action.generated === 'get';
  return (
    action.generated === 'create' ||
    action.generated === 'update' ||
    action.generated === 'archive' ||
    action.generated === 'restore'
  );
}

/**
 * The `graphql.enums` hints the schema cannot apply: an entry whose member is no readable top-level
 * enum member of the output (or of a subscription's event), one on an action the schema answers
 * with its entity type instead of the output shape, and a type name that is no GraphQL name, starts
 * with `__` or is one of the fixed type names. Checks projected and subscribed actions only.
 */
export function graphqlEnumHints(surface: ApiSurface): readonly TransportProblem[] {
  const problems: TransportProblem[] = [];
  const entities = new Set(surface.entities.map((entity) => entity.ref));
  for (const action of surface.actions.filter(
    (candidate) => isProjected(candidate) || isSubscribed(candidate),
  )) {
    const enums = action.hints.graphql?.enums;
    if (enums === undefined) continue;
    const entityAnswer = answersWithEntity(action, entities);
    for (const [member, typeName] of Object.entries(enums)) {
      const node = action.output.kind === 'shape' ? action.output.fields[member] : undefined;
      if (node?.kind !== 'enum') {
        problems.push(
          graphqlProblem(
            'unsupportedShape',
            action.ref,
            `hints.graphql.enums names '${member}', which is no enum member of the output. Name a top-level enum member, or remove the entry.`,
          ),
        );
      } else if (node.access === 'write') {
        problems.push(
          graphqlProblem(
            'unsupportedShape',
            action.ref,
            `hints.graphql.enums names '${member}', which is a write-only member: no output has it. Name a readable enum member, or remove the entry.`,
          ),
        );
      } else if (entityAnswer) {
        problems.push(
          graphqlProblem(
            'unsupportedShape',
            action.ref,
            `hints.graphql.enums names '${member}', but the schema answers this action with its entity type, not the output shape, so the hint would never apply. Remove the entry.`,
          ),
        );
      }
      if (!isGraphqlName(typeName) || typeName.startsWith('__')) {
        problems.push(
          graphqlProblem(
            'unsupportedShape',
            action.ref,
            `The enum type name '${typeName}' of hints.graphql.enums is no GraphQL name a schema may define: it starts with a letter or one underscore and holds letters, digits and underscores.`,
          ),
        );
      } else if (fixedTypeNames.has(typeName)) {
        problems.push(
          graphqlProblem(
            'reservedName',
            action.ref,
            `The type name '${typeName}' is reserved. Set another name in hints.graphql.enums, or rename it.`,
          ),
        );
      }
    }
  }
  return problems;
}
