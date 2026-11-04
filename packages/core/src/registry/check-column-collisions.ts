import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityModel } from './entity-model.ts';

const reserved: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
  'archived_at',
  'version',
  'kw_last_hlc',
  'kw_last_hash',
  'kw_erased_at',
  'kw_merge',
]);

/** The scope column a table of a tenancy carries: a deployment-scope table has none. */
const scopeColumns: Readonly<Record<string, readonly string[]>> = {
  tenant: ['tenant_id'],
  backend: ['backend_id'],
  deployment: [],
  invocation: ['tenant_id', 'backend_id'],
};

/** `columnCollisions`: a field whose column is a system or framework column, or another field's (section 14.4.2). */
export function checkColumnCollisions(
  entities: ReadonlyMap<string, EntityModel>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const { entry, tenancy } of entities.values()) {
    const scoped = new Set(scopeColumns[tenancy]);
    const seen = new Map<string, string>();
    for (const [name, descriptor] of Object.entries(entry.descriptor.fields)) {
      const other = seen.get(descriptor.column);
      if (reserved.has(descriptor.column) || scoped.has(descriptor.column) || other !== undefined) {
        problems.push(
          compositionError(
            'columnCollisions',
            `${entry.ref}.${name} maps to the column '${descriptor.column}', which ${other === undefined ? 'the table reserves' : `'${other}' has`}.`,
            { module: entry.module, ref: `${entry.ref}.${name}` },
          ),
        );
      }
      seen.set(descriptor.column, name);
    }
  }
  return problems;
}
