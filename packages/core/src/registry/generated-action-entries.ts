import type { ActionEntry } from './action-entry.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EntityModel } from './entity-model.ts';
import { generatedActionEntry } from './generated-action-entry.ts';
import { generatedActionSchemas } from './generated-action-schemas.ts';

/** The registry entries of the actions the core generates for one entity (section 6.7). */
export function generatedActionEntries(
  model: EntityModel,
  app: ComposableApp,
): readonly ActionEntry[] {
  return model.entry.generated.map((kind) =>
    generatedActionEntry(model.entry, kind, {
      schemas: generatedActionSchemas(kind, model.fields, model.entry.name),
      api: app.api,
      execution: app.execution,
    }),
  );
}
