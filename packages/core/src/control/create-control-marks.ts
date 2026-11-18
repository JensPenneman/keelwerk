import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { ScopeMark } from './scope-mark.ts';
import type { ScopeMarks } from './scope-marks.ts';

function marksOf(unit: Unit): NonNullable<Unit['marks']> {
  if (unit.marks === undefined) throw errors.unsupported('The control adapter has no scope marks.');
  return unit.marks;
}

/**
 * `ControlStore.marks`: every call runs in its own deployment-scope unit of the control namespace
 * (writing for `raise` and `bump`, read-only for the reads). The answers of `bumped` and `bump` feed
 * the epoch cache `epochs`: a scope id to its highest epoch over every namespace it has a row in.
 */
export function createControlMarks(
  adapter: DataAdapter,
  namespace: NamespaceRef,
  epochs: Map<string, number>,
): ScopeMarks {
  const raiseEpoch = (scopeId: string, epoch: number): void => {
    if (epoch > (epochs.get(scopeId) ?? 0)) epochs.set(scopeId, epoch);
  };
  return {
    list: (namespaceId, page) =>
      adapter.unit(
        namespace,
        { level: 'deployment' },
        (unit) => marksOf(unit).list(namespaceId, page),
        {
          readOnly: true,
        },
      ),
    bumped: async () => {
      const rows: readonly ScopeMark[] = await adapter.unit(
        namespace,
        { level: 'deployment' },
        (unit) => marksOf(unit).bumped(),
        { readOnly: true },
      );
      for (const row of rows) raiseEpoch(row.scopeId, row.epoch);
      return rows;
    },
    raise: (marks) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => marksOf(unit).raise(marks)),
    bump: async (mark, from) => {
      const epoch = await adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        marksOf(unit).bump(mark, from),
      );
      raiseEpoch(mark.scopeId, epoch);
      return epoch;
    },
  };
}
