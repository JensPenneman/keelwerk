import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityEntry } from './entity-entry.ts';

function holdsPersonal(field: FieldDescriptor): boolean {
  return field.personal !== false || (field.inner !== null && holdsPersonal(field.inner));
}

/**
 * `personalOutsideTenant` (14.7.5): erasure reaches the tenant scope, so a personal field, or a
 * data subject, on an entity of any other tenancy would hold a subject's values where erasure
 * cannot reach them. A backend, deployment or invocation entity that holds personal values is
 * refused at compose.
 */
export function checkPersonalOutsideTenant(
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const entry of entities.values()) {
    const { descriptor } = entry;
    if (descriptor.tenancy === 'tenant') continue;
    const personal = Object.entries(descriptor.fields)
      .filter(([, field]) => holdsPersonal(field))
      .map(([name]) => name);
    if (personal.length === 0 && descriptor.dataSubject === null) continue;
    const what =
      personal.length > 0
        ? `the personal field${personal.length > 1 ? 's' : ''} ${personal.join(', ')}`
        : `the data subject '${String(descriptor.dataSubject)}'`;
    problems.push(
      compositionError(
        'personalOutsideTenant',
        `'${entry.ref}' has ${descriptor.tenancy} tenancy and declares ${what}: erasure reaches tenant scope only, so a personal value must live on a tenant entity.`,
        { module: entry.module, ref: entry.ref },
      ),
    );
  }
  return problems;
}
