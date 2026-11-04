import { kebab } from '../naming/kebab.ts';
import { fitPhysicalName } from './fit-physical-name.ts';

/** PostgreSQL's identifier limit in bytes; MySQL's is 64 characters. */
const defaultMaxLength = 63;

/**
 * `<module>__<entity>` with `-` mapped to `_` and the entity in snake case; auxiliary tables append
 * `__<suffix>` (section 14.4.2, gap S-59). Pure: the registry and the planner both call it.
 */
export function physicalTableName(
  moduleId: string,
  entityName: string,
  options: { readonly suffix?: string; readonly maxLength?: number } = {},
): string {
  const entity = kebab(entityName).replaceAll('-', '_');
  const base = `${moduleId.replaceAll('-', '_')}__${entity}`;
  const full = options.suffix === undefined ? base : `${base}__${options.suffix}`;
  return fitPhysicalName(full, options.maxLength ?? defaultMaxLength);
}
