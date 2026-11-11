import { isMemberRecord } from '../api-versions/is-member-record.ts';
import type { StandardIssue } from '../fields/standard-schema-v1.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';
import { fromWire } from '../wire/from-wire.ts';
import { decodeFilter } from './decode-filter.ts';
import { inputMismatchError } from './input-mismatch-error.ts';

const filtered: ReadonlySet<string> = new Set(['query', 'queryChanges', 'watch']);

/**
 * Decodes the wire form of an action's input once (section 16.4.2): `fromWire` over the action's
 * input node, and for the `filter` member of a generated `query`, `queryChanges` or `watch` the id
 * operands through `decodeFilter`, with the entity of the action in `surface` (the surface of the
 * request's API version, so a filter names that version's fields). A `void` input is answered as
 * given. Every issue of the input and of its filter (paths from the input root, `['filter', ...]`)
 * is thrown together as `inputMismatchError`.
 */
export function decodeActionInput(
  surface: Pick<ApiSurface, 'entities'>,
  action: SurfaceAction,
  wire: unknown,
): unknown {
  if (action.input.kind === 'void') return wire;
  const result = fromWire(action.input, wire);
  const issues: StandardIssue[] = result.issues === undefined ? [] : [...result.issues];
  let value = result.issues === undefined ? result.value : undefined;
  const entities = new Map(surface.entities.map((candidate) => [candidate.ref, candidate]));
  const entityOf = (ref: string) => entities.get(ref);
  const entity =
    action.generated !== undefined && filtered.has(action.generated) && action.entity !== undefined
      ? entityOf(action.entity)
      : undefined;
  if (entity !== undefined && isMemberRecord(wire) && wire.filter !== undefined) {
    const decoded = decodeFilter(wire.filter, entity, entityOf, ['filter']);
    if (decoded.issues !== undefined) {
      issues.push(...decoded.issues);
    } else if (isMemberRecord(value)) {
      value = { ...value, filter: decoded.value };
    }
  }
  if (issues.length > 0) throw inputMismatchError(issues);
  return value;
}
