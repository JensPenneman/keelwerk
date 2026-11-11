import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { dataSubjectPathProblem } from './data-subject-path-problem.ts';
import type { EntityEntry } from './entity-entry.ts';
import { entityPathHead } from './entity-path-head.ts';

/** The subject path of a personal field, or of the personal element a list or set holds. */
function subjectOf(field: FieldDescriptor): string | undefined {
  if (field.personal !== false) return field.personal.subject;
  return field.inner === null ? undefined : subjectOf(field.inner);
}

/**
 * `entityDataSubject` (14.7.4, S-127): every data-subject path of an entity (its `dataSubject` and
 * the `subject` of each personal field) resolves as a whole, as an effect's does: no segment is
 * personal or sealed, each hop is a reference to an entity of the app, and the last segment is `id`
 * or a field that holds an id. An unresolvable path would otherwise fail every write of the row.
 */
export function checkEntitySubjects(
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const describe = (ref: string) => entities.get(ref)?.descriptor;
  for (const entry of entities.values()) {
    const { descriptor } = entry;
    const paths = new Set<string>();
    if (descriptor.dataSubject !== null) paths.add(descriptor.dataSubject);
    for (const field of Object.values(descriptor.fields)) {
      const path = subjectOf(field);
      if (path !== undefined) paths.add(path);
    }
    for (const path of paths) {
      const reason = dataSubjectPathProblem(describe, entityPathHead(descriptor), path);
      if (reason === undefined) continue;
      problems.push(
        compositionError(
          'entityDataSubject',
          `'${entry.ref}' names the data subject '${path}', ${reason}`,
          { module: entry.module, ref: entry.ref },
        ),
      );
    }
  }
  return problems;
}
