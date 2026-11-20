import { camelFromKebab, type SurfaceAction } from '@keelwerk/core';

/**
 * The path of an action in the router (and in the URL below the mount): the module id in lower
 * camel case (`app` for an app action), the entity name of an entity action and the action name.
 */
export function orpcPathOf(
  action: Pick<SurfaceAction, 'mount' | 'module' | 'entity' | 'name'>,
): readonly string[] {
  const module = action.mount === 'app' ? 'app' : camelFromKebab(action.module);
  if (action.entity === undefined) return [module, action.name];
  const prefix = `${action.module}.`;
  const entity = action.entity.startsWith(prefix)
    ? action.entity.slice(prefix.length)
    : action.entity;
  return [module, entity, action.name];
}
