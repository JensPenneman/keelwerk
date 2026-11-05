import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { redactKeys } from './redact-keys.ts';

/**
 * A command's output with the entity rows it carries redacted by the entity's field flags: a row
 * output is one row, a page output holds rows in `items`. A custom output holds no entity row and
 * is what the caller would receive.
 */
export function redactResult(registry: Registry, action: ActionEntry, result: unknown): unknown {
  const marker = action.entityOutput;
  const entry = marker === undefined ? undefined : registry.entities.get(marker.entity);
  if (marker === undefined || entry === undefined) return result;
  const { fields } = entry.descriptor;
  if (marker.shape === 'row') return redactKeys(fields, result);
  if (typeof result !== 'object' || result === null) return result;
  const items: unknown = Reflect.get(result, 'items');
  if (!Array.isArray(items)) return result;
  return { ...result, items: items.map((row: unknown) => redactKeys(fields, row)) };
}
