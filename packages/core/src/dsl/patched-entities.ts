import type { Behaviour } from '../model/behaviour.ts';
import type { EntityPatches } from './define-contribution.ts';

/**
 * The entities a contribution or conditional part touches, as the module value keeps them: each
 * declared patch with the actions the literal mounts on that entity, and an entity that only has
 * actions with empty fields and relations (section 4.7).
 */
export function patchedEntities(
  declared: EntityPatches | undefined,
  behaviour: Behaviour | undefined,
): { readonly [entity: string]: object } {
  const names = new Set([
    ...Object.keys(declared ?? {}),
    ...Object.keys(behaviour?.entityActions ?? {}),
  ]);
  return Object.fromEntries(
    [...names].map((name) => [
      name,
      {
        fields: declared?.[name]?.fields ?? {},
        relations: declared?.[name]?.relations ?? {},
        actions: behaviour?.entityActions?.[name] ?? {},
      },
    ]),
  );
}
