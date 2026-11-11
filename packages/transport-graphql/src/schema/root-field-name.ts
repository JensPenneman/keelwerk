import { camel, plural, type SurfaceAction } from '@keelwerk/core';

/**
 * The root field of an action (section 16.4.1): the `graphql.field` hint, else `camel(ref)` and,
 * for a generated `query`, the plural of the entity (`accountsProfiles`). An action mounted on the
 * app drops the `app.` prefix (`health`).
 */
export function rootFieldName(action: SurfaceAction): string {
  const hinted = action.hints.graphql?.field;
  if (hinted !== undefined) return hinted;
  if (action.generated === 'query' && action.entity !== undefined) {
    const separator = action.entity.indexOf('.');
    const module = action.entity.slice(0, separator);
    const name = action.entity.slice(separator + 1);
    return camel(`${module}.${plural(name)}`);
  }
  return camel(action.mount === 'app' ? action.ref.replace(/^app\./, '') : action.ref);
}
