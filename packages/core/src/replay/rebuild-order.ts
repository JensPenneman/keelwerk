import { errors } from '../errors/errors.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';

const effectRef = 'core.effect';

/**
 * The entities a rebuild of the scope folds, in the order it folds them: the `history: 'chain'`
 * entities whose tenancy lives in the scope (tenant scope: tenant and invocation; backend scope:
 * backend and invocation), each after the targets of its `kind: 'one'` relations (their rows are
 * foreign keys), ties by reference; `core.effect` last. Rejects with `unsupported` when relations
 * form a cycle.
 */
export function rebuildOrder(registry: Registry, scope: Scope): readonly EntityEntry[] {
  const tenancy = scope.level === 'tenant' ? 'tenant' : 'backend';
  const wanted = [...registry.entities.values()]
    .filter(
      (entry) =>
        entry.descriptor.history === 'chain' &&
        (entry.descriptor.tenancy === tenancy || entry.descriptor.tenancy === 'invocation'),
    )
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const folded = wanted.filter((entry) => entry.ref !== effectRef);
  const refs = new Set(folded.map((entry) => entry.ref));
  const waiting = new Map(
    folded.map((entry) => [
      entry.ref,
      new Set(
        Object.values(entry.descriptor.relations)
          .filter(
            (relation) =>
              relation.kind === 'one' && relation.target !== entry.ref && refs.has(relation.target),
          )
          .map((relation) => relation.target),
      ),
    ]),
  );
  const ordered: EntityEntry[] = [];
  const done = new Set<string>();
  while (ordered.length < folded.length) {
    const next = folded.find(
      (entry) =>
        !done.has(entry.ref) && [...(waiting.get(entry.ref) ?? [])].every((ref) => done.has(ref)),
    );
    if (next === undefined) {
      const stuck = folded.filter((entry) => !done.has(entry.ref)).map((entry) => entry.ref);
      throw errors.unsupported(
        `The entities ${stuck.join(', ')} reference each other in a cycle, so a rebuild has no order to insert their rows in.`,
      );
    }
    ordered.push(next);
    done.add(next.ref);
  }
  const effect = wanted.find((entry) => entry.ref === effectRef);
  return effect === undefined ? ordered : [...ordered, effect];
}
