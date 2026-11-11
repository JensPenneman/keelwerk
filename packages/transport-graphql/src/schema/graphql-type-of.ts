import type { FieldNode } from '@keelwerk/core';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLNullableType,
  GraphQLObjectType,
  GraphQLString,
  type GraphQLType,
} from 'graphql';
import type { GraphqlTypeTable } from './graphql-type-table.ts';
import { inputFieldsOf } from './input-fields-of.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';
import { nodeSignatureOf } from './node-signature-of.ts';
import { outputFieldsOf } from './output-fields-of.ts';

/**
 * The GraphQL type of a field node (section 16.6.1), nullable: the caller wraps it in `NonNull`
 * where the field is required (decision D4 makes every derived output field nullable). `name` is
 * the base name of the named types the node needs: an enum takes it as it is, a shape takes it
 * (output) or it plus `Input` (input), and its members extend it with their own names (decision
 * D3). Every enum value goes through `types.enumValues`, so the names it makes are checked. Values that have no GraphQL form of their own (free-form JSON, foreign schemas, blobs) are
 * `JSON`; a shape without members is `JSON` too, since GraphQL has no empty object type.
 */
export function graphqlTypeOf(
  node: FieldNode,
  name: string,
  direction: 'input' | 'output',
  types: GraphqlTypeTable,
): GraphQLType {
  switch (node.kind) {
    case 'string':
    case 'text':
    case 'subject':
    case 'secret':
      return GraphQLString;
    case 'boolean':
      return GraphQLBoolean;
    case 'float':
      return GraphQLFloat;
    case 'integer':
      return node.wide ? keelwerkScalars.BigInt : keelwerkScalars.SafeInt;
    case 'serial':
      return keelwerkScalars.SafeInt;
    case 'decimal':
      return keelwerkScalars.Decimal;
    case 'instant':
      return keelwerkScalars.Instant;
    case 'date':
      return keelwerkScalars.LocalDate;
    case 'timeZone':
      return keelwerkScalars.TimeZone;
    case 'binary':
      return keelwerkScalars.Base64URL;
    case 'richText':
      return keelwerkScalars.RichText;
    case 'id':
    case 'ref':
      return GraphQLID;
    case 'enum':
      return types.named(
        name,
        `node ${nodeSignatureOf(node)}`,
        () =>
          new GraphQLEnumType({
            name,
            values: types.enumValues(name, node.values),
          }),
      );
    case 'list':
    case 'set':
      return new GraphQLList(
        new GraphQLNonNull(graphqlTypeOf(node.item, name, direction, types) as GraphQLNullableType),
      );
    case 'shape': {
      const members = Object.values(node.fields).filter((member) =>
        direction === 'input' ? member.access !== 'read' : member.access !== 'write',
      );
      if (members.length === 0) return keelwerkScalars.JSON;
      if (direction === 'input') {
        return types.named(
          `${name}Input`,
          `node ${nodeSignatureOf(node)}`,
          () =>
            new GraphQLInputObjectType({
              name: `${name}Input`,
              fields: () =>
                types.members(
                  `${name}Input`,
                  inputFieldsOf(node.fields, name, types, graphqlTypeOf),
                ),
            }),
        );
      }
      return types.named(
        name,
        `node ${nodeSignatureOf(node)}`,
        () =>
          new GraphQLObjectType({
            name,
            fields: () =>
              types.members(name, outputFieldsOf(node.fields, name, types, graphqlTypeOf)),
          }),
      );
    }
    case 'json':
    case 'foreign':
    case 'blob':
    case 'void':
    case 'page':
      return keelwerkScalars.JSON;
    default: {
      const unknownKind: never = node;
      throw new TypeError(`unknown field kind ${JSON.stringify(unknownKind)}`);
    }
  }
}
