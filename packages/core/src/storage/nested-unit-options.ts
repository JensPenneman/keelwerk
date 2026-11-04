import type { StorageScope } from './storage-scope.ts';

/**
 * How a savepoint of a unit opens (section 14.3.6). A unit spans one scope, with one exception: a
 * tenant unit may open `{ as: <backend scope>, readOnly: true }` to read backend entities on an
 * adapter whose single session cannot open a second unit; any other `as` is refused with
 * `core.forbidden`. `readOnly` makes the savepoint refuse writes, and it never widens a read-only unit.
 */
export interface NestedUnitOptions {
  readonly as?: StorageScope;
  readonly readOnly?: boolean;
}
