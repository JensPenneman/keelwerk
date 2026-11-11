import { pascal, type SurfaceEntity } from '@keelwerk/core';
import { GraphQLEnumType, GraphQLInputObjectType, GraphQLNonNull } from 'graphql';
import type { BuildEnv } from './build-env.ts';

/**
 * `<Type>Sort { field: <Type>SortField!, direction: SortDirection }` of an entity (section 16.4.4);
 * `undefined` when the entity sorts by no field, since an enum needs a value.
 */
export function sortInputOf(
  env: BuildEnv,
  entity: SurfaceEntity,
): GraphQLInputObjectType | undefined {
  if (entity.page.sortable.length === 0) return undefined;
  const typeName = pascal(entity.ref);
  const types = env.types.of(entity.ref);
  const field = types.named(
    `${typeName}SortField`,
    `entity ${entity.ref}`,
    () =>
      new GraphQLEnumType({
        name: `${typeName}SortField`,
        values: types.enumValues(`${typeName}SortField`, entity.page.sortable),
      }),
  );
  return types.named(
    `${typeName}Sort`,
    `entity ${entity.ref}`,
    () =>
      new GraphQLInputObjectType({
        name: `${typeName}Sort`,
        fields: types.members(`${typeName}Sort`, [
          {
            name: 'field',
            subject: entity.ref,
            from: 'sort field',
            config: { type: new GraphQLNonNull(field) },
          },
          {
            name: 'direction',
            subject: entity.ref,
            from: 'sort direction',
            config: { type: env.fixed.sortDirection },
          },
        ]),
      }),
  );
}
