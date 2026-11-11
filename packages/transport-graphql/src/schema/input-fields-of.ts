import { type FieldNode, pascal } from '@keelwerk/core';
import {
  type GraphQLInputFieldConfig,
  GraphQLNonNull,
  type GraphQLNullableInputType,
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
 * The input fields of the members of a shape: a member the caller may write (not read-only, not
 * void), required when it is neither optional nor defaulted. `prefix` is the base name of the
 * named types the members need; `typeOf` is `graphqlTypeOf`. The caller adds what else the input
 * has and builds the map with `types.members`, so every name is checked once. A member whose name
 * is no GraphQL name gets a placeholder type and no named type: `types.members` reports it, and a
 * type named after it would be invalid.
 */
export function inputFieldsOf(
  fields: Readonly<Record<string, FieldNode>>,
  prefix: string,
  types: GraphqlTypeTable,
  typeOf: TypeOf,
): readonly GraphqlMember<GraphQLInputFieldConfig>[] {
  const out: GraphqlMember<GraphQLInputFieldConfig>[] = [];
  for (const [name, node] of Object.entries(fields)) {
    if (node.access === 'read' || node.kind === 'void') continue;
    const type = (
      isGraphqlName(name) ? typeOf(node, `${prefix}${pascal(name)}`, 'input', types) : GraphQLString
    ) as GraphQLNullableInputType;
    const required = !node.optional && node.default === undefined;
    out.push({
      name,
      subject: types.subject,
      from: `field '${name}'`,
      config: {
        type: required ? new GraphQLNonNull(type) : type,
        ...(node.description === undefined ? {} : { description: node.description }),
      },
    });
  }
  return out;
}
