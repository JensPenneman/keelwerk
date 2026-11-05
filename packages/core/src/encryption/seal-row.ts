import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { eqTag } from './eq-tag.ts';
import { normalizedText } from './normalized-text.ts';
import { normalizerOf } from './normalizer-of.ts';
import { personalFieldsOf } from './personal-fields-of.ts';
import { sealStateColumn } from './seal-state-column.ts';
import type { SealingContext } from './sealing-context.ts';
import { subjectIdOf } from './subject-id-of.ts';

/**
 * A row as the adapter stores it (14.7.9.6): each personal value sealed under its subject's data
 * key, with the blind index tag of every `eq` capability beside it. An absent value stays a null
 * column and a null tag. Rows of entities without personal fields pass through.
 */
export async function sealRow(
  context: SealingContext,
  entity: EntityDescriptor,
  row: StorageRow,
): Promise<StorageRow> {
  const fields = personalFieldsOf(entity);
  if (fields.length === 0) return row;
  const sealed: Record<string, unknown> = { ...row };
  for (const column of Object.keys(entity.derivedIndexes)) delete sealed[column];
  for (const { name, field, personal } of fields) {
    const value = row[name];
    if (value === undefined || value === null) {
      delete sealed[name];
      continue;
    }
    if (personal.keys === 'subject') {
      throw errors.not_implemented(
        `${entity.ref}.${name}: subject-scoped index keys arrive with the mail store.`,
      );
    }
    const subject = await subjectIdOf(context, entity, personal.subject, row);
    if (subject === undefined) {
      throw errors.validation(
        `${entity.ref}.${name} is personal and needs its data subject "${personal.subject}".`,
        { issues: [{ path: [name], message: `Needs the data subject "${personal.subject}".` }] },
      );
    }
    const key = await context.dataKey(subject);
    sealed[name] = sealStateColumn(
      key,
      value,
      {
        namespace: context.unit.namespace.id,
        entity: entity.ref,
        rowId: String(row.id),
        field: name,
      },
      context.random,
    );
    for (const derived of Object.values(entity.derivedIndexes)) {
      if (derived.field !== name || derived.query !== 'eq') continue;
      const text = normalizedText(field, normalizerOf(context, personal), value);
      if (text === undefined) continue;
      sealed[derived.column] = eqTag(
        await context.indexKeys.fieldKey(entity, name, personal, derived),
        text,
        personal.params.eq.bits,
      );
    }
  }
  return sealed;
}
