import {
  type ApiSurface,
  type FieldNode,
  filterOperatorsOf,
  pascal,
  type SurfaceEntity,
} from '@keelwerk/core';
import {
  GraphQLBoolean,
  type GraphQLInputFieldConfig,
  type GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
  type GraphQLInputType,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLNullableInputType,
  GraphQLString,
} from 'graphql';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';
import { isGraphqlName } from './is-graphql-name.ts';
import { nodeSignatureOf } from './node-signature-of.ts';

/** The name stem of the operator input of a field: the scalar it compares (`String`, `Instant`, an enum's own name). */
function stemOf(node: FieldNode, enumName: string): string {
  switch (node.kind) {
    case 'string':
    case 'text':
      return 'String';
    case 'subject':
      return 'Subject';
    case 'timeZone':
      return 'TimeZone';
    case 'boolean':
      return 'Boolean';
    case 'integer':
      return node.wide ? 'BigInt' : 'SafeInt';
    case 'serial':
      return 'SafeInt';
    case 'float':
      return 'Float';
    case 'decimal':
      return 'Decimal';
    case 'instant':
      return 'Instant';
    case 'date':
      return 'LocalDate';
    case 'id':
    case 'ref':
      return 'Id';
    case 'binary':
      return 'Base64URL';
    case 'enum':
      return enumName;
    case 'list':
    case 'set':
      return `${stemOf(node.item, enumName)}List`;
    default:
      return 'Presence';
  }
}

function holdsEnum(node: FieldNode): boolean {
  if (node.kind === 'enum') return true;
  return (node.kind === 'list' || node.kind === 'set') && holdsEnum(node.item);
}

function operandOf(
  operator: string,
  node: FieldNode,
  value: GraphQLInputType,
  enumName: string,
  types: GraphqlTypeTable,
): GraphQLInputType {
  switch (operator) {
    case 'in':
    case 'nin':
      return new GraphQLList(new GraphQLNonNull(value as GraphQLNullableInputType));
    case 'isNull':
      return GraphQLBoolean;
    case 'startsWith':
      return GraphQLString;
    case 'contains':
      return node.kind === 'list' || node.kind === 'set'
        ? (graphqlTypeOf(node.item, enumName, 'input', types) as GraphQLInputType)
        : GraphQLString;
    default:
      return value;
  }
}

/** The operator input of one field: one member per operator the field accepts (section 16.4.4). */
function operatorInputOf(
  node: FieldNode,
  operators: readonly string[],
  enumName: string,
  types: GraphqlTypeTable,
): GraphQLInputObjectType {
  const stem = stemOf(node, enumName);
  const name = `${stem}${node.personal === true ? 'Personal' : ''}Filter`;
  return types.named(
    name,
    holdsEnum(node) ? `node ${nodeSignatureOf(node)}` : `scalar ${stem}`,
    () =>
      new GraphQLInputObjectType({
        name,
        fields: () => {
          const value = graphqlTypeOf(node, enumName, 'input', types) as GraphQLInputType;
          const fields: GraphQLInputFieldConfigMap = {};
          for (const operator of operators) {
            fields[operator] = { type: operandOf(operator, node, value, enumName, types) };
          }
          return fields;
        },
      }),
  );
}

function relationFilterOf(
  target: SurfaceEntity,
  surface: ApiSurface,
  types: GraphqlTypeTable,
): GraphQLInputObjectType {
  const name = `${pascal(target.ref)}RelationFilter`;
  return types.named(
    name,
    `entity ${target.ref}`,
    () =>
      new GraphQLInputObjectType({
        name,
        fields: () => {
          const filter = filterInputOf(target, surface, types);
          return {
            some: { type: filter },
            none: { type: filter },
            every: { type: filter },
            is: { type: filter },
          };
        },
      }),
  );
}

/**
 * `<Type>Filter` of an entity (section 16.6.1): `and`, `or`, `not`, one operator input per field
 * the entity's fields allow to filter on (`filterOperatorsOf`) and `some`, `none`, `every`, `is`
 * per relation. The operator inputs are shared by every field of the same scalar.
 */
export function filterInputOf(
  entity: SurfaceEntity,
  surface: ApiSurface,
  table: GraphqlTypeTable,
): GraphQLInputObjectType {
  const typeName = pascal(entity.ref);
  const name = `${typeName}Filter`;
  const types = table.of(entity.ref);
  return types.named(
    name,
    `entity ${entity.ref}`,
    () =>
      new GraphQLInputObjectType({
        name,
        fields: () => {
          const self = filterInputOf(entity, surface, types);
          const entry = (
            member: string,
            from: string,
            type: GraphQLInputType,
          ): GraphqlMember<GraphQLInputFieldConfig> => ({
            name: member,
            subject: entity.ref,
            from,
            config: { type },
          });
          const entries: GraphqlMember<GraphQLInputFieldConfig>[] = [
            entry('and', "operator 'and'", new GraphQLList(new GraphQLNonNull(self))),
            entry('or', "operator 'or'", new GraphQLList(new GraphQLNonNull(self))),
            entry('not', "operator 'not'", self),
          ];
          for (const [field, node] of Object.entries(entity.fields)) {
            const operators = isGraphqlName(field) ? filterOperatorsOf(node) : [];
            if (operators.length > 0) {
              entries.push(
                entry(
                  field,
                  `field '${field}'`,
                  operatorInputOf(node, operators, `${typeName}${pascal(field)}`, types),
                ),
              );
            }
          }
          for (const [relation, spec] of Object.entries(entity.relations)) {
            const target = surface.entities.find((candidate) => candidate.ref === spec.target);
            if (target !== undefined) {
              entries.push(
                entry(relation, `relation '${relation}'`, relationFilterOf(target, surface, types)),
              );
            }
          }
          return types.members(name, entries);
        },
      }),
  );
}
