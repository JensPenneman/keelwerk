import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import { evaluateCondition, KeelwerkError } from '@keelwerk/core';
import { memoryValueKey } from './memory-value-key.ts';

interface UniqueConstraint {
  readonly name: string;
  readonly fields: readonly string[];
  readonly where: Condition | null;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Every `unique` field and unique index of an entity (14.5.1): among non-archived rows. */
function constraints(entity: EntityDescriptor): readonly UniqueConstraint[] {
  const found: UniqueConstraint[] = [];
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.unique) found.push({ name, fields: [name], where: null });
  }
  for (const index of entity.indexes) {
    if (index.unique) found.push({ name: index.name, fields: index.fields, where: index.where });
  }
  return found;
}

/** The value a unique tuple compares: a personal field's blind index tag, else the stored value. */
function component(entity: EntityDescriptor, row: StorageRow, field: string): unknown {
  const declared = entity.fields[field];
  if (declared?.personal !== false && declared !== undefined) {
    for (const [name, index] of Object.entries(entity.derivedIndexes)) {
      if (index.field === field && index.query === 'eq') return row[name];
    }
  }
  return row[field];
}

function tupleOf(
  entity: EntityDescriptor,
  constraint: UniqueConstraint,
  row: StorageRow,
): string | undefined {
  if (present(row.archivedAt)) return undefined;
  if (constraint.where !== null && !evaluateCondition(constraint.where, row)) return undefined;
  const parts: string[] = [];
  for (const field of constraint.fields) {
    const value = component(entity, row, field);
    // A tuple with an absent member is distinct from every other (NULLS DISTINCT).
    if (!present(value)) return undefined;
    parts.push(memoryValueKey(value, entity.fields[field]?.kind === 'decimal'));
  }
  return parts.join('\u0001');
}

/**
 * Throws `conflict` when `candidate` would repeat a unique tuple of `others`. A row that is
 * archived, or that a partial index excludes, takes part in no tuple, so archiving releases the
 * value and restoring a taken one conflicts.
 */
export function memoryCheckUnique(
  entity: EntityDescriptor,
  candidate: StorageRow,
  others: Iterable<StorageRow>,
): void {
  const active = constraints(entity)
    .map((constraint) => ({ constraint, tuple: tupleOf(entity, constraint, candidate) }))
    .filter((entry) => entry.tuple !== undefined);
  if (active.length === 0) return;
  for (const other of others) {
    if (other.id === candidate.id) continue;
    for (const { constraint, tuple } of active) {
      if (tupleOf(entity, constraint, other) === tuple) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.conflict',
          message: `${entity.ref} already has a row with this ${constraint.fields.join(', ')}`,
          details: { entity: entity.ref, constraint: constraint.name, fields: constraint.fields },
        });
      }
    }
  }
}
