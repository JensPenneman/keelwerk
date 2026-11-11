import { type ApiSurface, camel, pascal } from '@keelwerk/core';
import { actionTypeName } from '../schema/action-type-name.ts';
import { isProjected } from '../schema/is-projected.ts';
import { rootFieldName } from '../schema/root-field-name.ts';

/** A name the projection will take and the entity, action or error that takes it. */
interface Planned {
  readonly name: string;
  readonly subject: string;
}

/**
 * The names the schema of a surface will define, before it is built: the top-level types, the Query
 * fields and the Mutation fields, each with the reference that takes it. The check finds reserved
 * names in these lists; collisions are found by the build itself (`inspectGraphqlSurface`).
 */
export function plannedNames(surface: ApiSurface): {
  readonly types: readonly Planned[];
  readonly queryFields: readonly Planned[];
  readonly mutationFields: readonly Planned[];
} {
  const types: Planned[] = [];
  const queryFields: Planned[] = [];
  const mutationFields: Planned[] = [];
  const actions = surface.actions.filter(isProjected);
  for (const entity of surface.entities) {
    const name = pascal(entity.ref);
    types.push({ name, subject: entity.ref }, { name: `${name}Filter`, subject: entity.ref });
    if (actions.some((a) => a.entity === entity.ref && a.generated === 'query')) {
      types.push(
        { name: `${name}Connection`, subject: entity.ref },
        { name: `${name}Sort`, subject: entity.ref },
        { name: `${name}SortField`, subject: entity.ref },
      );
    }
    if (actions.some((a) => a.entity === entity.ref && a.generated === 'get')) {
      types.push({ name: `${name}GetResult`, subject: entity.ref });
    }
    if (actions.some((a) => a.entity === entity.ref && a.generated === 'update')) {
      types.push({ name: `${name}Patch`, subject: entity.ref });
    }
  }
  const codes = new Set<string>();
  for (const action of actions) {
    const name = actionTypeName(action);
    const field = rootFieldName(action);
    if (action.kind === 'query') {
      queryFields.push({ name: field, subject: action.ref });
      if (action.generated === 'get' && action.entity !== undefined) {
        queryFields.push({ name: camel(action.entity), subject: action.ref });
      }
      if (action.output.kind === 'shape') {
        types.push({ name: `${name}Output`, subject: action.ref });
      } else if (action.output.kind === 'page' && action.entity === undefined) {
        types.push({ name: `${name}Connection`, subject: action.ref });
      }
      continue;
    }
    mutationFields.push({ name: field, subject: action.ref });
    types.push(
      { name: `${name}Input`, subject: action.ref },
      { name: `${name}Result`, subject: action.ref },
      { name: `${name}Success`, subject: action.ref },
    );
    const writes = ['create', 'update', 'archive', 'restore'];
    if (action.output.kind === 'shape' && !writes.includes(action.generated ?? '')) {
      types.push({ name: `${name}Output`, subject: action.ref });
    }
    for (const code of action.errors) codes.add(code);
  }
  for (const code of codes) types.push({ name: `${pascal(code)}Error`, subject: code });
  return { types, queryFields, mutationFields };
}
