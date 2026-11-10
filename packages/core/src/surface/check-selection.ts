import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { SelectionLimits } from './selection-limits.ts';
import type { SelectionMeasure, SelectionPath } from './selection-measure.ts';

function pathOf(path: SelectionPath): readonly string[] {
  return [...path.entities, path.field];
}

function refuse(message: string, path: readonly string[]): KeelwerkError {
  return errors.validation(message, { issues: [{ path, message }] });
}

function countRefusal(
  count: number,
  max: number,
  plural: 'aliases' | 'operations' | 'tokens',
  singular: 'alias' | 'operation' | 'token',
): KeelwerkError | null {
  if (count <= max) return null;
  return refuse(`The selection has ${count} ${plural}; the ${singular} limit is ${max}.`, []);
}

function repeatedEntity(path: SelectionPath): string | undefined {
  return path.entities.find((ref, index) => path.entities.indexOf(ref) !== index);
}

/**
 * Checks a selection against every limit of 16.4.12 and returns the first refusal, or `null` when
 * it passes. The order is: no repeated entity type, depth, aliases, operations, tokens, cost. A
 * limit is a maximum: a value equal to it passes. The cost is one per selected leaf plus ten per
 * connection page. A refusal is a `validation` error naming the path (for the first two checks)
 * and the limit; nothing is thrown.
 */
export function checkSelection(
  selection: SelectionMeasure,
  limits: SelectionLimits,
): KeelwerkError | null {
  if (limits.noRepeatedEntity) {
    for (const path of selection.paths) {
      const ref = repeatedEntity(path);
      if (ref !== undefined) {
        return refuse(
          `The selection path ${pathOf(path).join(' > ')} repeats the entity type ${ref} (noRepeatedEntity).`,
          pathOf(path),
        );
      }
    }
  }
  for (const path of selection.paths) {
    if (path.entities.length > limits.depth) {
      return refuse(
        `The selection path ${pathOf(path).join(' > ')} is ${path.entities.length} levels deep; the depth limit is ${limits.depth}.`,
        pathOf(path),
      );
    }
  }
  const counted =
    countRefusal(selection.aliases, limits.aliases, 'aliases', 'alias') ??
    countRefusal(selection.operations, limits.operations, 'operations', 'operation') ??
    countRefusal(selection.tokens, limits.tokens, 'tokens', 'token');
  if (counted !== null) return counted;
  const cost = selection.paths.length + 10 * selection.connectionPages;
  if (cost > limits.cost) {
    return refuse(
      `The selection costs ${cost}; the cost limit is ${limits.cost} (1 per field, 10 per connection page).`,
      [],
    );
  }
  return null;
}
