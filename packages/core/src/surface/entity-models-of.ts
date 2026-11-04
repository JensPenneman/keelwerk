import type { AppSelection } from '../registry/app-selection.ts';
import type { AppliedPart } from '../registry/applied-part.ts';
import { buildEntities } from '../registry/build-entities.ts';
import type { EntityModel } from '../registry/entity-model.ts';
import type { RuntimeModule } from '../registry/runtime-module.ts';

/**
 * The entities of an app with the field definitions they were built from, by reference. The
 * registry keeps descriptors only, and a field node needs the definition (default, description,
 * schema), so the surface rebuilds the models the registry was built from. Pure.
 */
export function entityModelsOf(
  selection: AppSelection,
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
): ReadonlyMap<string, EntityModel> {
  return buildEntities(selection, ordered, parts);
}
