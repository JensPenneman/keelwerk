import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import type { FieldChange } from './field-change.ts';

/** The field changes of a version change, in declared order: renames, added required fields and removed fields. An action rename is none. */
export function fieldChangesOf(change: VersionChangeEntry): readonly FieldChange[] {
  return change.surface.flatMap((spec): FieldChange[] => {
    const { entity, field } = spec;
    if (entity === undefined || field === undefined) return [];
    if (spec.renamedFrom !== undefined) {
      return [{ kind: 'renamed', entity, field, was: spec.renamedFrom }];
    }
    if (spec.addedRequired === true) return [{ kind: 'added', entity, field }];
    if (spec.removed === true) return [{ kind: 'removed', entity, field }];
    return [];
  });
}
