import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { entityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { isMemberRecord } from './is-member-record.ts';
import { renameKey } from './rename-key.ts';
import { rewritePositions } from './rewrite-positions.ts';

type Row = Readonly<Record<string, unknown>>;

function maskedOf(row: Row): readonly string[] {
  const names = row.$masked;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string')
    : [];
}

function withMasked(row: Row, names: readonly string[]): Row {
  const { $masked: _before, ...rest } = row;
  if (names.length === 0) return rest;
  return { ...rest, $masked: [...new Set(names)].sort(compareCodePoints) };
}

/** The `{ entity, id, version }` a command answers for a row its caller may not read. */
function isReference(row: Row): boolean {
  return typeof row.entity === 'string' && Object.keys(row).length === 3;
}

function rowOut(row: unknown, changes: ReturnType<typeof fieldChangesOf>, plain: boolean): unknown {
  if (!isMemberRecord(row)) return row;
  let next: Row = row;
  for (const change of changes) {
    const names = maskedOf(next);
    if (change.kind === 'renamed') {
      next = renameKey(next, change.field, change.was);
      if (!plain && names.includes(change.field)) {
        next = withMasked(
          next,
          names.map((name) => (name === change.field ? change.was : name)),
        );
      }
    } else if (change.kind === 'added') {
      if (Object.hasOwn(next, change.field)) {
        next = Object.fromEntries(Object.entries(next).filter(([key]) => key !== change.field));
      }
      if (!plain && names.includes(change.field)) {
        next = withMasked(
          next,
          names.filter((name) => name !== change.field),
        );
      }
    } else if (
      !(plain || isReference(next)) &&
      (!Object.hasOwn(next, change.field) || next[change.field] === undefined)
    ) {
      if (Object.hasOwn(next, change.field)) {
        next = Object.fromEntries(Object.entries(next).filter(([key]) => key !== change.field));
      }
      if (!names.includes(change.field)) next = withMasked(next, [...names, change.field]);
    }
  }
  return next;
}

/**
 * The mechanical half of one change's output translation (head to older), after its custom
 * transform: fields renamed in rows (`$masked` follows), an added required field dropped, and a
 * removed field that is absent or undefined in the row deleted and named in `$masked` (the caller
 * learns the value is unavailable, section 18.2; nothing else is inferred, so a transform that
 * answers a fallback is not named). The member names of a history entry's `changes` follow the same
 * renames and carry no `$masked`.
 */
export function mechanicalOutput(
  change: VersionChangeEntry,
  action: ActionEntry,
  value: unknown,
): unknown {
  const positions = entityPositions(action);
  if (positions === undefined) return value;
  const own = fieldChangesOf(change).filter((item) => item.entity === positions.entity);
  if (own.length === 0) return value;
  let next = value;
  for (const path of positions.outputRows) {
    const plain = action.generated === 'history' && path.at(-1) === 'changes';
    next = rewritePositions(next, path, (row) => rowOut(row, own, plain));
  }
  return next;
}
