import type { ActionEntry } from '../registry/action-entry.ts';
import { decodeShapeValue } from './decode-shape-value.ts';

/**
 * The value a receipt kept (`encodeEventValue` of the output) read back through the action's
 * output schema, so an instant, a wide integer, bytes or a set come back as themselves. An output
 * that is not a shape of fields is JSON already and is returned as stored.
 */
export function decodeCommandValue(action: ActionEntry, stored: unknown): unknown {
  return decodeShapeValue(action.output, action.module, stored);
}
