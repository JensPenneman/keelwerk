import { camelFromKebab, type SurfaceAction } from '@keelwerk/core';

/**
 * The path of an action's procedure (section 16.7.2): the module id in lower camel case, then the
 * entity's name when the action belongs to an entity, then the action's name; app actions sit under
 * `app`.
 */
export function trpcPathOf(action: SurfaceAction): readonly string[] {
  switch (action.mount) {
    case 'app':
      return ['app', action.name];
    case 'entity': {
      const entity = (action.entity ?? '').split('.').at(-1) ?? '';
      return [camelFromKebab(action.module), entity, action.name];
    }
    case 'module':
      return [camelFromKebab(action.module), action.name];
  }
}
