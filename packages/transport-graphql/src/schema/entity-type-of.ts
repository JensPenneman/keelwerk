import { pascal, type SurfaceEntity } from '@keelwerk/core';
import {
  type GraphQLFieldConfig,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { referenceResolver } from '../resolve/reference-resolver.ts';
import { relationResolver } from '../resolve/relation-resolver.ts';
import { actionArgsOf } from './action-args-of.ts';
import type { BuildEnv } from './build-env.ts';
import { connectionTypeOf } from './connection-type-of.ts';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import { isProjected } from './is-projected.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';
import { outputFieldsOf } from './output-fields-of.ts';
import { projectedGetOf } from './projected-get-of.ts';
import { referenceFieldName } from './reference-field-name.ts';

/** What a field back to its own entity type says: the repeated-entity rule of section 16.4.12 refuses any selection of it under the default limits. */
const repeatedNote =
  'Refused by the repeated-entity rule (section 16.4.12) under the default limits: the entity type would appear twice on the path.';

/**
 * The object type of an entity (section 16.6.1): it implements `Node`, carries every readable
 * field (nullable except `id` and `version`, because a mask may hide the others per row), `_masked`,
 * the object beside each to-one reference (resolved through the request's loader) and a
 * connection per to-many relation (one `query` per parent, and only when that `query` is served by
 * the schema). Every name goes through `members`, so a clash is a problem of the check.
 */
export function entityTypeOf(env: BuildEnv, entity: SurfaceEntity): GraphQLObjectType {
  const name = pascal(entity.ref);
  const types = env.types.of(entity.ref);
  env.entityTypes.set(name, entity.ref);
  return types.named(
    name,
    `entity ${entity.ref}`,
    () =>
      new GraphQLObjectType({
        name,
        interfaces: [env.fixed.node],
        fields: () => {
          const entries: GraphqlMember<GraphQLFieldConfig<unknown, unknown>>[] = outputFieldsOf(
            entity.fields,
            name,
            types,
            graphqlTypeOf,
          ).map((entry) => {
            if (entry.name === 'id') {
              return { ...entry, config: { ...entry.config, type: new GraphQLNonNull(GraphQLID) } };
            }
            if (entry.name === 'version') {
              return {
                ...entry,
                config: { ...entry.config, type: new GraphQLNonNull(keelwerkScalars.SafeInt) },
              };
            }
            return entry;
          });
          entries.push({
            name: '_masked',
            subject: entity.ref,
            from: "list of masked fields '_masked'",
            config: {
              type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))),
              description: 'The fields a rule hides from the caller on this row.',
              resolve: (row: unknown) =>
                typeof row === 'object' && row !== null ? (Reflect.get(row, '$masked') ?? []) : [],
            },
          });
          for (const [field, node] of Object.entries(entity.fields)) {
            if (node.kind !== 'ref' || node.access === 'write') continue;
            const target = env.entities.get(node.target);
            if (target === undefined || projectedGetOf(env.surface, node.target) === undefined) {
              continue;
            }
            entries.push({
              name: referenceFieldName(field, target),
              subject: entity.ref,
              from: `reference object of '${field}'`,
              config: {
                type: entityTypeOf(env, target),
                ...(target.ref === entity.ref ? { description: repeatedNote } : {}),
                resolve: referenceResolver(field, target.ref) as never,
              },
            });
          }
          for (const [relation, spec] of Object.entries(entity.relations)) {
            const target = env.entities.get(spec.target);
            const query = env.surface.actions.find(
              (action) =>
                action.entity === spec.target &&
                action.generated === 'query' &&
                isProjected(action),
            );
            if (
              spec.kind !== 'many' ||
              spec.by === undefined ||
              target === undefined ||
              query === undefined
            ) {
              continue;
            }
            entries.push({
              name: relation,
              subject: entity.ref,
              from: `relation '${relation}'`,
              config: {
                type: new GraphQLNonNull(connectionTypeOf(env, target, entityTypeOf(env, target))),
                args: actionArgsOf(env, query),
                ...(target.ref === entity.ref ? { description: repeatedNote } : {}),
                resolve: relationResolver(spec.by, query) as never,
              },
            });
          }
          return types.members(name, entries);
        },
      }),
  );
}
