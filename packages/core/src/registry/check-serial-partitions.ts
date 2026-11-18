import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityEntry } from './entity-entry.ts';
import { holdsPersonal } from './holds-personal.ts';

/**
 * `serialPartition` (14.7.5, 15.1.4): the values of a serial's `per` field are kept in plain text,
 * in `kw_serials.partition` and in the mark name of `kw_scope_marks`, where no erasure reaches. So
 * `per` must name a field of the entity that holds no personal value, is not sealed and is not the
 * entity's data subject; a `per` that names no field is refused too.
 */
export function checkSerialPartitions(
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const entry of entities.values()) {
    const { descriptor } = entry;
    for (const [name, field] of Object.entries(descriptor.fields)) {
      const per = field.kind === 'serial' ? field.constraints.per : undefined;
      if (per === undefined) continue;
      const partition = descriptor.fields[per];
      const reason =
        partition === undefined
          ? 'names no field of the entity'
          : holdsPersonal(partition)
            ? 'names a personal field'
            : partition.sealed
              ? 'names a sealed field'
              : descriptor.dataSubject === per
                ? "names the entity's data subject"
                : undefined;
      if (reason === undefined) continue;
      problems.push(
        compositionError(
          'serialPartition',
          `'${entry.ref}' declares the serial '${name}' per '${per}', which ${reason}: the partition values are kept in plain text where erasure cannot reach them, so a serial is partitioned by a field that holds no personal, sealed or subject value.`,
          { module: entry.module, ref: entry.ref },
        ),
      );
    }
  }
  return problems;
}
