import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { EntityEntry } from '../../registry/entity-entry.ts';
import type { Registry } from '../../registry/registry.ts';

/** Where the entity rows are in an action's output. */
export interface EntityOutput {
  readonly form: 'row' | 'page';
  readonly entity: EntityEntry;
}

/**
 * The entity whose rows an action's output carries, read from the `entityOutput` marker of the
 * action entry (`rowOf(entity)` is a row, `pageOf(entity)` a page of rows; sections 9.2 and
 * 16.2.2). Undefined for a custom output, which holds no entity row; `core.internal` when the
 * marker names an entity the registry lacks.
 */
export function entityOutputOf(registry: Registry, action: ActionEntry): EntityOutput | undefined {
  const marker = action.entityOutput;
  if (marker === undefined) return undefined;
  const entity = registry.entities.get(marker.entity);
  if (entity === undefined) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `The output of "${action.ref}" names the entity "${marker.entity}", which the registry does not hold.`,
    });
  }
  return { form: marker.shape, entity };
}
