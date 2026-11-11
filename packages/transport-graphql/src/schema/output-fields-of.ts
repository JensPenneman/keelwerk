import { type FieldNode, pascal } from '@keelwerk/core';
import {
  type GraphQLFieldConfig,
  type GraphQLOutputType,
  GraphQLString,
  type GraphQLType,
} from 'graphql';
import type { GraphqlMember } from './graphql-member.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';
import { isGraphqlName } from './is-graphql-name.ts';

/** The function that gives a field node its GraphQL type (`graphqlTypeOf`); the caller passes it so that the two modules do not import each other. */
type TypeOf = (
  node: FieldNode,
  name: string,
  direction: 'input' | 'output',
  types: GraphqlTypeTable,
) => GraphQLType;

/**
 * The object fields of the members of a shape: every readable member, nullable (decision D4: a
 * mask, a selection or `omitFromBody` may remove any member). `prefix` is the base name of the
 * named types the members need; `typeOf` is `graphqlTypeOf`. The caller adds what else the type
 * has and builds the map with `types.members`, so every name is checked once. A member whose name
 * is no GraphQL name gets a placeholder type and no named type: `types.members` reports it, and a
 * type named after it would be invalid.
 */
export function outputFieldsOf(
  fields: Readonly<Record<string, FieldNode>>,
  prefix: string,
  types: GraphqlTypeTable,
  typeOf: TypeOf,
): readonly GraphqlMember<GraphQLFieldConfig<unknown, unknown>>[] {
  const out: GraphqlMember<GraphQLFieldConfig<unknown, unknown>>[] = [];
  for (const [name, node] of Object.entries(fields)) {
    if (node.access === 'write' || node.kind === 'void') continue;
    out.push({
      name,
      subject: types.subject,
      from: `field '${name}'`,
      config: {
        type: (isGraphqlName(name)
          ? typeOf(node, `${prefix}${pascal(name)}`, 'output', types)
          : GraphQLString) as GraphQLOutputType,
        ...(node.description === undefined ? {} : { description: node.description }),
      },
    });
  }
  return out;
}
