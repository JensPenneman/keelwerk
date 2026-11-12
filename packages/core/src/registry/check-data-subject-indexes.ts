import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityEntry } from './entity-entry.ts';

/** Whether a plain index leads with the field: `.index()`, or a declared index without `where`. */
function isIndexed(descriptor: EntityDescriptor, name: string): boolean {
  if (descriptor.fields[name]?.indexed === true) return true;
  return descriptor.indexes.some((index) => index.where === null && index.fields[0] === name);
}

/**
 * `dataSubjectUnindexed` (14.7.5): the erasure finds the rows a subject owns by a lookup per
 * entity, on the data-subject field and on every field the path walks through. A field of that
 * lookup, other than `id`, that no plain index leads with makes the lookup scan the table: the
 * erasure stays correct, only slower. A unique field does not count, because its index is partial
 * on the rows that are not archived and the erasure reads archived rows too. A warning.
 */
export function checkDataSubjectIndexes(
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const reported = new Set<string>();
  for (const entry of entities.values()) {
    const path = entry.descriptor.dataSubject;
    if (path === null || entry.descriptor.tenancy !== 'tenant') continue;
    let current: EntityEntry | undefined = entry;
    for (const segment of path.split('.')) {
      if (current === undefined) break;
      const descriptor: EntityDescriptor = current.descriptor;
      if (segment !== 'id' && !isIndexed(descriptor, segment)) {
        const key = `${descriptor.ref}.${segment}`;
        if (!reported.has(key)) {
          reported.add(key);
          problems.push({
            code: 'dataSubjectUnindexed',
            severity: 'warning',
            message: `'${descriptor.ref}.${segment}' is looked up when a subject is erased (the data subject of '${entry.ref}' is '${path}') and no plain index leads with it: an erasure scans the table. Declare it with .index().`,
            module: descriptor.module,
            ref: descriptor.ref,
          });
        }
      }
      const target: string | undefined = descriptor.fields[segment]?.ref?.entity;
      current = target === undefined ? undefined : entities.get(target);
    }
  }
  return problems;
}
