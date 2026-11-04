import { allOf } from '../authorization/all-of.ts';
import { compilePlan } from '../authorization/compile-plan.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** What the target of an entity command is loaded with. */
export interface LoadTargetInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly entry: EntityEntry;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly input: unknown;
  readonly reads: RecordedRead[];
}

/**
 * Phase 4 of section 7.9.4: the target of an entity command, selected through the plan's `where`
 * (`not_found` outside it), locked where the adapter has row locks, with the scope position read
 * after the lock and recorded as the first read of the decision. `decide` receives the full row.
 * `ifVersion` that is not the row's version is `core.version_mismatch` and is never repeated.
 */
export async function loadTarget(input: LoadTargetInput): Promise<StorageRow> {
  const { id, ifVersion } = input.input as { readonly id?: unknown; readonly ifVersion?: unknown };
  if (typeof id !== 'string')
    throw errors.validation('An entity command needs the id of its target.');
  const plan = compilePlan({
    rules: input.rules,
    action: input.action,
    entity: input.entry.descriptor,
    context: principalContextOf(input.registry, input.principal, input.scope),
  });
  const found = await createEntityRepository(input.unit, input.entry).find({
    where: allOf([{ op: 'eq', field: 'id', value: id }, plan.where]),
    page: { first: 1 },
    forUpdate: true,
  });
  const row = found.rows[0];
  if (row === undefined) throw errors.not_found(`${input.entry.ref} ${id} does not exist`);
  input.reads.push({ at: found.position });
  if (typeof ifVersion === 'number' && Number(row.version) !== ifVersion) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'The row is not at the version the request named.',
      details: { ifVersion: true, entity: input.entry.ref, id },
    });
  }
  return row;
}
