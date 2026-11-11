import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { generatedActionEntry } from '../registry/generated-action-entry.ts';
import { permissiveSchema } from '../registry/permissive-schema.ts';
import type { InvokerApp } from './invoker-app.ts';

/**
 * The entity's `watch` action: the registered one, else the one the template would add, built by
 * the same function the registry uses. The entry decides and authorizes only (the subscription
 * parses its own input), so the schemas are the one member the caller chooses and nothing validates
 * against them: an entity entry holds descriptors, not the field definitions they derive from.
 */
export function watchActionOf(app: InvokerApp, entry: EntityEntry): ActionEntry {
  const registered = app.registry.actions.get(`${entry.ref}.watch`);
  if (registered !== undefined) return registered;
  return generatedActionEntry(entry, 'watch', {
    schemas: { input: permissiveSchema(), output: permissiveSchema() },
    api: app.api,
    execution: {},
  });
}
