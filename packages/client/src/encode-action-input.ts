import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { encodeFilter } from '@keelwerk/core/wire';
import { clientFailure } from './client-failure.ts';
import { encodeWithSurface } from './encode-with-surface.ts';
import { isRecord } from './is-record.ts';

const filtered: ReadonlySet<string> = new Set(['query', 'queryChanges', 'watch']);

/**
 * The wire form of the input of an action, by the surface it was loaded with: `encodeWithSurface`
 * over the action's input node, and for the `filter` member of a generated `query`, `queryChanges`
 * or `watch` the id operands through `encodeFilter` with the entity of the action, so a filter
 * on an id or a reference carries public ids like every other input (16.4.2, 16.4.4). An operand
 * that does not fit its field is a `core.validation` failure with the issue at its path.
 */
export function encodeActionInput(
  surface: Pick<ApiSurface, 'entities'>,
  action: SurfaceAction,
  input: unknown,
): unknown {
  const wire = encodeWithSurface(action.input, input, action.ref);
  if (action.generated === undefined || !filtered.has(action.generated)) return wire;
  if (!isRecord(input) || input.filter === undefined || !isRecord(wire)) return wire;
  const entityOf = (ref: string) => surface.entities.find((entity) => entity.ref === ref);
  const entity = action.entity === undefined ? undefined : entityOf(action.entity);
  if (entity === undefined) return wire;
  const encoded = encodeFilter(input.filter, entity, entityOf);
  if (encoded.issues !== undefined) {
    throw clientFailure(
      'core.validation',
      `The input of ${action.ref} is invalid: ${encoded.issues
        .map((issue) => issue.message)
        .join('; ')}.`,
      {
        issues: encoded.issues.map((issue) => ({
          path: [
            'filter',
            ...(issue.path ?? []).map((segment) =>
              typeof segment === 'object' ? segment.key : segment,
            ),
          ],
          message: issue.message,
        })),
      },
    );
  }
  return { ...wire, filter: encoded.value };
}
