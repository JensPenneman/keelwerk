import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { redactEffectInput } from './redact-effect-input.ts';
import { redactKeys } from './redact-keys.ts';

/**
 * A command's output as explain shows it: the entity rows it carries by the field flags of their
 * entity (a row output is one row, a page output holds rows in `items`), any other output by the
 * flags of the action's output schema, as an effect input is redacted (a member that is hidden or
 * holds a mark of the output's site, or any member of a schema with no keelwerk fields, becomes
 * `[redacted]`). A value that is no object holds no member to flag and is redacted whole.
 */
export function redactResult(registry: Registry, action: ActionEntry, result: unknown): unknown {
  const marker = action.entityOutput;
  const entry = marker === undefined ? undefined : registry.entities.get(marker.entity);
  if (marker === undefined || entry === undefined) {
    if (result === undefined || result === null) return result;
    if (typeof result !== 'object' || Array.isArray(result)) return '[redacted]';
    return redactEffectInput('commandOutput', action.output, result);
  }
  const { fields } = entry.descriptor;
  if (marker.shape === 'row') return redactKeys('entity', fields, result);
  if (typeof result !== 'object' || result === null) return result;
  const items: unknown = Reflect.get(result, 'items');
  if (!Array.isArray(items)) return result;
  return { ...result, items: items.map((row: unknown) => redactKeys('entity', fields, row)) };
}
